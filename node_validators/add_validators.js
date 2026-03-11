/**
 * add_validators.js
 *
 * Turns nodes started by run_n_nodes.sh into active validators.
 *
 * Usage:
 *   node add_validators.js <start_node_index> <end_node_index> "<funder_seed>"
 *
 * Example:
 *   node add_validators.js 4 5 "neutral mother faculty picnic stand ill virtual donkey later clinic aim chronic"
 *
 * Port mapping matches run_n_nodes.sh exactly:
 *   WS_PORT = 9944 + node_index  (e.g., n4 -> 9948, n5 -> 9949)
 *
 * The funder_seed should be a mnemonic or //DevAccount of an account
 * that has enough REEF to fund each new validator (at least 2M REEF each).
 */

const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const { cryptoWaitReady, mnemonicGenerate } = require('@polkadot/util-crypto');
const net = require('net');

// Check if a TCP port is open before trying WebSocket connection
function checkPortOpen(host, port, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);
        socket.on('connect', () => { socket.destroy(); resolve(); });
        socket.on('timeout', () => { socket.destroy(); reject(new Error(`Timeout connecting to ${host}:${port}`)); });
        socket.on('error', (err) => reject(new Error(`Cannot reach ${host}:${port} — ${err.message}`)));
        socket.connect(port, host);
    });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function decodeDispatchError(api, dispatchError) {
    if (dispatchError.isModule) {
        try {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            return `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
        } catch (_) {
            return `Module error index ${dispatchError.asModule.index}:${dispatchError.asModule.error}`;
        }
    }
    return dispatchError.toString();
}

function waitForInBlock(api, tx, signer, label) {
    return new Promise((resolve, reject) => {
        tx.signAndSend(signer, { nonce: -1 }, ({ status, dispatchError, events }) => {
            if (dispatchError) {
                const msg = decodeDispatchError(api, dispatchError);
                reject(new Error(`${label} dispatch error: ${msg}`));
            } else if (status.isInBlock) {
                // double-check no batch-internal errors
                for (const { event } of events) {
                    if (api.events.system.ExtrinsicFailed.is(event)) {
                        const [err] = event.data;
                        reject(new Error(`${label} extrinsic failed: ${decodeDispatchError(api, err)}`));
                        return;
                    }
                }
                console.log(`  ✓ ${label} included in block ${status.asInBlock.toHex()}`);
                resolve(status.asInBlock);
            } else if (status.isError) {
                reject(new Error(`${label} transaction error`));
            }
        }).catch(reject);
    });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
    await cryptoWaitReady();

    const args = process.argv.slice(2);

    if (args.length < 2 || args.length > 3) {
        console.error('Usage: node add_validators.js <start_index> <end_index> ["<funder_seed>"]');
        console.error('');
        console.error('  start_index  - first node number from run_n_nodes.sh (e.g. 4)');
        console.error('  end_index    - last  node number from run_n_nodes.sh (e.g. 5)');
        console.error('  funder_seed  - mnemonic OR //DevKey of an account with funds');
        console.error('                 (defaults to //Alice, only works on --dev chains)');
        console.error('');
        console.error('Example with custom account:');
        console.error('  node add_validators.js 4 5 "neutral mother faculty ..."');
        console.error('');
        console.error('Example with dev chain:');
        console.error('  node add_validators.js 4 5 "//Alice"');
        process.exit(1);
    }

    const startNode = parseInt(args[0], 10);
    const endNode = parseInt(args[1], 10);
    // Default funder: PHRASE_1 from insert_keys.sh (pre-funded in customSpec.json)
    const DEFAULT_FUNDER = 'neutral mother faculty picnic stand ill virtual donkey later clinic aim chronic';
    const funderSeed = args[2] || DEFAULT_FUNDER;

    if (isNaN(startNode) || isNaN(endNode) || startNode > endNode || startNode < 1) {
        console.error('Error: Invalid node indices. Both must be positive integers with start <= end.');
        process.exit(1);
    }

    const keyring = new Keyring({ type: 'sr25519' });
    const funder = keyring.addFromUri(funderSeed);

    console.log(`Setting up validators n${startNode} → n${endNode}`);
    console.log(`Funder account : ${funder.address}`);
    console.log('');

    // Connect to the main node (n1 always runs on ws 9944)
    console.log('Connecting to main node on ws://127.0.0.1:9944 ...');
    const mainWs = new WsProvider('ws://127.0.0.1:9944');
    const mainApi = await ApiPromise.create({ provider: mainWs });

    // Verify funder has balance
    const { data: funderBal } = await mainApi.query.system.account(funder.address);
    console.log(`Funder balance : ${funderBal.free.toHuman()}`);

    if (funderBal.free.isZero()) {
        console.error('');
        console.error('ERROR: Funder account has 0 balance!');
        console.error('Please provide a funded account seed as the third argument.');
        console.error('The funded addresses in customSpec.json are:');
        console.error('  5CofGsPhVSLRJbhSG9CDxvNmjMKUs7FYnDUyCUVAmK92rjVU (large balance)');
        console.error('  5DArzS36XYktF4Bthq7b6uet22xuwu5pxW5wJqw6yXyB82tB');
        console.error('  5CJEBk43FsjhuRKoHbD1aty1fXimMVwHfwHjcuirVfpuDGmd');
        console.error('');
        console.error('Provide the mnemonic of one of these accounts as the third parameter.');
        await mainApi.disconnect();
        process.exit(1);
    }

    console.log('');

    // Amount to transfer to each new validator stash: 2,000,000 REEF (18 decimals)
    const FUND_AMOUNT = BigInt('2000000' + '0'.repeat(18));
    // Amount to bond for staking: 1,000,000 REEF
    const BOND_AMOUNT = BigInt('1000000' + '0'.repeat(18));

    for (let i = startNode; i <= endNode; i++) {
        // Port matches run_n_nodes.sh: WS_PORT=$((9944 + i))
        const wsPort = 9944 + i;

        console.log(`${'═'.repeat(50)}`);
        console.log(`  Node n${i}  (WS: ws://127.0.0.1:${wsPort})`);
        console.log(`${'═'.repeat(50)}`);

        // ── Step 1: Generate a fresh stash account for this validator ──────
        const mnemonic = mnemonicGenerate();
        const stash = keyring.addFromUri(mnemonic);
        console.log(`Step 1 | Stash address : ${stash.address}`);
        console.log(`        Mnemonic        : ${mnemonic}`);
        console.log('        (SAVE this mnemonic! It controls the validator stake.)');

        // ── Step 2: Fund the stash account ────────────────────────────────
        console.log(`Step 2 | Funding stash from ${funder.address} ...`);
        await waitForInBlock(
            mainApi,
            mainApi.tx.balances.transferKeepAlive(stash.address, FUND_AMOUNT.toString()),
            funder,
            'Fund transfer'
        );

        // ── Step 3: Rotate session keys on the specific node ──────────────
        console.log(`Step 3 | Rotating session keys on ws://127.0.0.1:${wsPort} ...`);

        // First verify the node is actually up before trying WS (avoids hanging forever)
        try {
            await checkPortOpen('127.0.0.1', wsPort, 10000);
        } catch (portErr) {
            throw new Error(
                `Node n${i} is NOT reachable on port ${wsPort}.\n` +
                `  Make sure you ran: ./run_n_nodes.sh <N> before this script.\n` +
                `  Error: ${portErr.message}`
            );
        }

        const nodeWs = new WsProvider(`ws://127.0.0.1:${wsPort}`);
        // Timeout if API init takes more than 20s
        const nodeApi = await Promise.race([
            ApiPromise.create({ provider: nodeWs }),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`Timed out connecting to n${i} WS`)), 20000))
        ]);

        const sessionKeys = await nodeApi.rpc.author.rotateKeys();
        console.log(`        Session keys : ${sessionKeys.toHex()}`);
        await nodeApi.disconnect();

        // ── Step 4: Bond + set keys + validate in a single batch ──────────
        console.log(`Step 4 | Submitting bond + setKeys + validate batch ...`);

        // Handle both old (3-arg: stash, controller, value, payee)
        // and new (2-arg: value, payee) staking.bond APIs
        let bondTx;
        if (mainApi.tx.staking.bond.meta.args.length >= 3) {
            bondTx = mainApi.tx.staking.bond(
                stash.address,          // controller = stash (self)
                BOND_AMOUNT.toString(),
                'Staked'
            );
        } else {
            bondTx = mainApi.tx.staking.bond(
                BOND_AMOUNT.toString(),
                'Staked'
            );
        }

        const setKeysTx = mainApi.tx.session.setKeys(sessionKeys.toHex(), '0x');
        const validateTx = mainApi.tx.staking.validate({ commission: 0 });

        await waitForInBlock(
            mainApi,
            mainApi.tx.utility.batchAll([bondTx, setKeysTx, validateTx]),
            stash,
            'Bond+SetKeys+Validate'
        );

        console.log(`  ✓ Node n${i} is now queued as a validator!`);
        console.log('');
    }

    await mainApi.disconnect();

    console.log('');
    console.log('All done! The nodes will become active validators in the next session.');
    console.log('Monitor with: polkadot.js.org/apps or check staking.validators on-chain.');
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
