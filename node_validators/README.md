# Validator Automation Script

Turns extra nodes started by `run_n_nodes.sh` into active on-chain validators.

## Quick Start

```bash
# 1. Start base nodes
cd /data/Project/REEF/REEF_SCRIPTS
./run_nodes.sh restart        # purges state + inserts keys + starts n1/n2/n3

# 2. Start extra nodes (e.g. 2 more → n4 and n5)
./run_n_nodes.sh 2

# 3. Register them as validators  (wait ~30 s for nodes to sync first)
node node_validators/add_validators.js 4 5 "<funder_mnemonic>"
```

## Arguments

| Argument | Description |
|---|---|
| `start_index` | First new node number (matches what `run_n_nodes.sh` spun up) |
| `end_index` | Last new node number |
| `funder_seed` | Mnemonic **or** `//DevKey` of an account that holds REEF to fund each validator |

> **TIP**: The `--dev` flag isn't set, so `//Alice` has 0 balance. Pass the mnemonic of one of the accounts pre-funded in `customSpec.json`:
> ```
> 5CofGsPhVSLRJbhSG9CDxvNmjMKUs7FYnDUyCUVAmK92rjVU  (largest balance)
> ```

## Port Mapping (matches run_n_nodes.sh exactly)

| Node | WS Port |
|------|---------|
| n4   | 9948    |
| n5   | 9949    |
| n6   | 9950    |
| n_i  | 9944 + i |

## What the script does per node

1. **Generates** a fresh stash/controller keypair (prints mnemonic — save it!)
2. **Funds** the stash from the `funder_seed` account (2,000,000 REEF)
3. **Rotates session keys** by connecting directly to that specific node's WS port
4. **Submits** a `batchAll([staking.bond, session.setKeys, staking.validate])` transaction signed by the new stash

Nodes become active validators at the start of the next session/era.
