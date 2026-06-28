# Test Plan

Run the contract tests from the `hardhat/` folder:

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

