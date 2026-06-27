# Ritual Chain Workshop: Privacy-Preserving AI Bounty Judge

This fork implements the required commit-reveal assignment for the Ritual Academy bounty judge workshop. The original plaintext `submitAnswer` flow has been replaced with a two-phase flow so participants cannot copy answers during the submission window.

## What Changed

- Added `submitCommitment(uint256 bountyId, bytes32 commitment)`.
- Added `revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt)`.
- Added `calculateCommitment(...)` helper using `keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))`.
- Added `getCommitment(...)` for UI/status checks.
- Updated `judgeAll(...)` so only revealed answers are eligible.
- Updated `finalizeWinner(...)` to reject invalid revealed-submission indexes.
- Updated the web app to submit a commitment first, save the answer/salt locally, and reveal after the deadline.

## Lifecycle

1. The bounty owner creates a bounty with a reward, rubric, and deadline.
2. During the commit phase, each participant submits only a commitment hash.
3. The answer, salt, wallet address, and bounty id are not stored on-chain during the commit phase.
4. After the deadline, participants reveal their answer and salt.
5. The contract recomputes `keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))`.
6. Only matching reveals are stored as submissions.
7. `judgeAll` evaluates the batch of revealed submissions.
8. The owner calls `finalizeWinner` with a valid revealed-submission index and the reward is paid.

## Architecture Note

The required track keeps answers hidden during the submission phase, but plaintext exists on-chain during the reveal phase. On-chain storage contains commitment hashes before the deadline and revealed plaintext answers after the deadline. The web app stores the answer and salt in local browser storage so the participant can reveal later.

For a Ritual-native hidden-submission design, plaintext should remain off-chain and encrypted until the judging step. Participants would store encrypted answers off-chain and commit to their ciphertext/hash on-chain. At judging time, the bounty owner would send one batched request to Ritual TEE-backed execution. The TEE would decrypt all valid submissions, build one LLM prompt, and return a signed or otherwise verifiable judging result. On-chain state would store commitments, reveal/proof metadata, and the final AI review output, while plaintext would exist only inside the participant client before encryption and inside the TEE during batch judging.

## Test Plan

Run from `hardhat/`:

```shell
npm install
npx hardhat test
```

Covered cases:

- Commitment stores only the hash before the deadline.
- Reveal is allowed only after the deadline.
- Wrong wallet reveal is rejected.
- Wrong salt reveal is rejected.
- `judgeAll` and `finalizeWinner` operate only on revealed submissions.

Current local result:

```text
3 passing (3 nodejs)
```

## Reflection

Commitments, bounty metadata, deadlines, rewards, and final payouts should be public because participants need a verifiable process and sponsors need accountability. Raw answers should stay hidden during the submission phase so later participants cannot copy or lightly improve earlier work. In the required commit-reveal version, answers become public during reveal, which is acceptable for a simple EVM-compatible design but not ideal for highly sensitive bounties. AI should help rank submissions against a published rubric, summarize strengths and weaknesses, and flag obvious plagiarism or invalid answers. A human bounty owner should still finalize the winner because reward decisions can involve context, edge cases, and values that are not fully captured by an LLM score. The system should make AI reasoning auditable without letting AI become the only authority over funds. The fairest design is public process, private submissions until the right phase, AI-assisted review, and human final accountability.

