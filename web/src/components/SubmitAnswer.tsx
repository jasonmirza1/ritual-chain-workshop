"use client";

import { useMemo, useState } from "react";
import { encodePacked, keccak256, type Hex } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canSubmit, type Bounty } from "@/lib/bounty";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

type RevealSecret = {
  answer: string;
  salt: Hex;
  commitment: Hex;
};

function isZeroHash(value?: Hex) {
  return !value || /^0x0{64}$/i.test(value);
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function makeStorageKey(bountyId: bigint, address?: string) {
  if (!contractAddress || !address) return "";
  return `commit-reveal:${ritualChain.id}:${contractAddress}:${bountyId.toString()}:${address.toLowerCase()}`;
}

function loadRevealSecret(key: string): RevealSecret | null {
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null") as RevealSecret | null;
    if (!parsed?.answer || !parsed.salt || !parsed.commitment) return null;
    return parsed;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function SubmitAnswer({
  bountyId,
  bounty,
  onSubmitted,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onSubmitted: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [answer, setAnswer] = useState("");
  const [secretVersion, setSecretVersion] = useState(0);
  const now = useNow();
  const storageKey = useMemo(() => makeStorageKey(bountyId, address), [bountyId, address]);
  void secretVersion;
  const secret = loadRevealSecret(storageKey);

  const {
    data: commitmentData,
    refetch: refetchCommitment,
  } = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "getCommitment",
    args: address ? [bountyId, address] : undefined,
    chainId: ritualChain.id,
    query: { enabled: !!contractAddress && !!address },
  });

  const commitTx = useWriteTx(() => {
    void refetchCommitment();
    onSubmitted();
  });
  const revealTx = useWriteTx(() => {
    if (storageKey) localStorage.removeItem(storageKey);
    setSecretVersion((version) => version + 1);
    void refetchCommitment();
    onSubmitted();
  });

  const hasCommitted = !isZeroHash(commitmentData?.[0]);
  const hasRevealed = Boolean(commitmentData?.[1]);
  const commitOpen = canSubmit(bounty, now / 1000);
  const revealOpen =
    !bounty.judged && !bounty.finalized && Number(bounty.deadline) <= now / 1000;

  if (!commitOpen && !revealOpen) return null;

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !contractAddress || !address) return;

    const cleanAnswer = answer.trim();
    const salt = randomSalt();
    const commitment = keccak256(
      encodePacked(
        ["string", "bytes32", "address", "uint256"],
        [cleanAnswer, salt, address, bountyId],
      ),
    );
    const nextSecret = { answer: cleanAnswer, salt, commitment };

    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(nextSecret));
      setSecretVersion((version) => version + 1);
    }

    try {
      await commitTx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "submitCommitment",
        args: [bountyId, commitment],
        chainId: ritualChain.id,
      });
      setAnswer("");
    } catch {
      /* surfaced via commitTx.state */
    }
  }

  async function handleReveal() {
    if (!secret || !contractAddress) return;
    try {
      await revealTx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, secret.answer, secret.salt],
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via revealTx.state */
    }
  }

  if (revealOpen) {
    return (
      <Card>
        <CardHeader
          title="Reveal answer"
          subtitle="Only revealed answers are eligible for judging."
        />
        <CardBody className="space-y-3">
          {hasRevealed ? (
            <Notice tone="green">Your answer has been revealed.</Notice>
          ) : secret ? (
            <>
              <Notice tone="amber">
                Reveal the answer and salt saved in this browser.
              </Notice>
              <Button
                type="button"
                onClick={handleReveal}
                disabled={!isConnected || revealTx.isBusy}
                className="w-full"
              >
                {revealTx.isBusy ? "Revealing..." : "Reveal answer"}
              </Button>
              <TxStatus
                state={revealTx.state}
                error={revealTx.error}
                hash={revealTx.hash}
                explorerBase={explorerBase}
              />
            </>
          ) : (
            <Notice tone={hasCommitted ? "red" : "zinc"}>
              {hasCommitted
                ? "This wallet committed, but the local reveal secret is missing."
                : "No commitment from this wallet for this bounty."}
            </Notice>
          )}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Commit answer"
        subtitle="Only a hash is submitted before the deadline."
      />
      <CardBody>
        {hasCommitted ? (
          <Notice tone="green">Commitment submitted. Keep this browser for reveal.</Notice>
        ) : (
          <form onSubmit={handleCommit} className="space-y-3">
            <Field label="Your answer">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={5}
                placeholder="Write your submission..."
              />
            </Field>
            <Button
              type="submit"
              disabled={!isConnected || !answer.trim() || commitTx.isBusy}
              className="w-full"
            >
              {commitTx.isBusy ? "Committing..." : "Submit commitment"}
            </Button>
            {!isConnected && (
              <p className="text-xs text-zinc-500">
                Connect your wallet to submit.
              </p>
            )}
            <TxStatus
              state={commitTx.state}
              error={commitTx.error}
              hash={commitTx.hash}
              explorerBase={explorerBase}
            />
          </form>
        )}
      </CardBody>
    </Card>
  );
}
