import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { encodePacked, keccak256, parseEther, type Hex } from "viem";

function commitmentFor(
  answer: string,
  salt: Hex,
  submitter: Hex,
  bountyId: bigint,
) {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "address", "uint256"],
      [answer, salt, submitter, bountyId],
    ),
  );
}

async function deployFixture() {
  const { viem, networkHelpers } = await network.create();
  const [owner, alice, bob] = await viem.getWalletClients();
  const ownerJudge = await viem.deployContract("AIJudge", [], {
    client: { wallet: owner },
  });
  const aliceJudge = await viem.getContractAt("AIJudge", ownerJudge.address, {
    client: { wallet: alice },
  });
  const bobJudge = await viem.getContractAt("AIJudge", ownerJudge.address, {
    client: { wallet: bob },
  });
  const now = await networkHelpers.time.latest();
  const deadline = BigInt(now + 60);

  await ownerJudge.write.createBounty(["Hidden bounty", "Pick the clearest answer", deadline], {
    value: parseEther("1"),
  });

  return { networkHelpers, ownerJudge, aliceJudge, bobJudge, alice, bob, deadline };
}

describe("AIJudge commit-reveal", () => {
  it("stores only a commitment during the commit phase and reveals after the deadline", async () => {
    const { networkHelpers, ownerJudge, aliceJudge, alice, deadline } = await deployFixture();
    const bountyId = 1n;
    const answer = "Use a commit-reveal phase so answers cannot be copied.";
    const salt = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const commitment = commitmentFor(answer, salt, alice.account.address, bountyId);

    await aliceJudge.write.submitCommitment([bountyId, commitment]);

    const [storedCommitment, revealed] = await ownerJudge.read.getCommitment([
      bountyId,
      alice.account.address,
    ]);
    const bountyBeforeReveal = await ownerJudge.read.getBounty([bountyId]);

    assert.equal(storedCommitment, commitment);
    assert.equal(revealed, false);
    assert.equal(bountyBeforeReveal[7], 0n);

    await networkHelpers.time.increaseTo(Number(deadline));
    await aliceJudge.write.revealAnswer([bountyId, answer, salt]);

    const [submitter, storedAnswer] = await ownerJudge.read.getSubmission([bountyId, 0n]);
    const [, revealedAfter] = await ownerJudge.read.getCommitment([
      bountyId,
      alice.account.address,
    ]);

    assert.equal(submitter.toLowerCase(), alice.account.address.toLowerCase());
    assert.equal(storedAnswer, answer);
    assert.equal(revealedAfter, true);
  });

  it("rejects a reveal with the wrong salt or wallet", async () => {
    const { networkHelpers, aliceJudge, bobJudge, alice, deadline } = await deployFixture();
    const bountyId = 1n;
    const answer = "A private submission";
    const salt = "0x2222222222222222222222222222222222222222222222222222222222222222";
    const badSalt = "0x3333333333333333333333333333333333333333333333333333333333333333";
    const commitment = commitmentFor(answer, salt, alice.account.address, bountyId);

    await aliceJudge.write.submitCommitment([bountyId, commitment]);
    await networkHelpers.time.increaseTo(Number(deadline));

    await assert.rejects(
      () => bobJudge.write.revealAnswer([bountyId, answer, salt]),
      /no commitment/,
    );
    await assert.rejects(
      () => aliceJudge.write.revealAnswer([bountyId, answer, badSalt]),
      /invalid reveal/,
    );
  });

  it("judges and finalizes only revealed answers", async () => {
    const { networkHelpers, ownerJudge, aliceJudge, alice, deadline } = await deployFixture();
    const bountyId = 1n;
    const answer = "The only revealed answer";
    const salt = "0x4444444444444444444444444444444444444444444444444444444444444444";
    const commitment = commitmentFor(answer, salt, alice.account.address, bountyId);
    const review = "0x7b2277696e6e6572496e646578223a302c2272616e6b696e67223a5b5d7d" as Hex;

    await aliceJudge.write.submitCommitment([bountyId, commitment]);
    await networkHelpers.time.increaseTo(Number(deadline));
    await aliceJudge.write.revealAnswer([bountyId, answer, salt]);
    await ownerJudge.write.judgeAll([bountyId, review]);
    await ownerJudge.write.finalizeWinner([bountyId, 0n]);

    const bounty = await ownerJudge.read.getBounty([bountyId]);

    assert.equal(bounty[5], true);
    assert.equal(bounty[6], true);
    assert.equal(bounty[8], 0n);
    assert.equal(bounty[9], review);
  });
});
