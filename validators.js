/**
 * validators.js  —  Register reef-node extra nodes as on-chain validators
 *
 * Usage:
 *   node validators.js              # auto-reads .last_nodes written by run_n_nodes.sh
 *   node validators.js 4 5          # explicitly register n4 and n5
 *   node validators.js 4 5 "seed"   # use a custom funder seed phrase
 *
 * Port mapping (matches run_n_nodes.sh exactly):
 *   WS_PORT = 9944 + node_index   →  n4=9948, n5=9949, n6=9950 ...
 */

const { ApiPromise, WsProvider } = require('./node_validators/node_modules/@polkadot/api');
const { Keyring } = require('./node_validators/node_modules/@polkadot/keyring');
const { cryptoWaitReady, mnemonicGenerate } = require('./node_validators/node_modules/@polkadot/util-crypto');
const net = require('net');
const fs = require('fs');
const path = require('path');

// ── TCP port health check ─────────────────────────────────────────────────────
function checkPortOpen(host, port, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);
        socket.on('connect', () => { socket.destroy(); resolve(); });
        socket.on('timeout', () => { socket.destroy(); reject(new Error(`Timeout`)); });
        socket.on('error', (e) => reject(new Error(e.message)));
        socket.connect(port, host);
    });
}

// ── Decode dispatch errors ────────────────────────────────────────────────────
function decodeError(api, dispatchError) {
    if (dispatchError.isModule) {
        try {
            const d = api.registry.findMetaError(dispatchError.asModule);
            return `${d.section}.${d.name}: ${d.docs.join(' ')}`;
        } catch (_) { /* fall through */ }
    }
    return dispatchError.toString();
}

// ── Wait for tx to land in a block ───────────────────────────────────────────
function waitInBlock(api, tx, signer, label) {
    return new Promise((resolve, reject) => {
        tx.signAndSend(signer, { nonce: -1 }, ({ status, dispatchError, events }) => {
            if (dispatchError) {
                return reject(new Error(`${label} failed: ${decodeError(api, dispatchError)}`));
            }
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (api.events.system.ExtrinsicFailed.is(event)) {
                        const [err] = event.data;
                        return reject(new Error(`${label} extrinsic failed: ${decodeError(api, err)}`));
                    }
                }
                console.log(`  ✓ ${label} → block ${status.asInBlock.toHex()}`);
                resolve(status.asInBlock);
            } else if (status.isError) {
                reject(new Error(`${label} transaction error`));
            }
        }).catch(reject);
    });
}

// ── Read node range from .last_nodes state file ───────────────────────────────
function readLastNodes() {
    const stateFile = path.join(__dirname, '.last_nodes');
    if (!fs.existsSync(stateFile)) return null;
    const [s, e] = fs.readFileSync(stateFile, 'utf8').trim().split(' ').map(Number);
    if (isNaN(s) || isNaN(e)) return null;
    return { start: s, end: e };
}

// ── Show currently running extra nodes ────────────────────────────────────────
async function scanRunningNodes() {
    const running = [];
    for (let port = 9947; port <= 9980; port++) {
        try {
            await checkPortOpen('127.0.0.1', port, 500);
            const nodeIndex = port - 9944;
            running.push({ index: nodeIndex, wsPort: port });
        } catch (_) { /* not open */ }
    }
    return running;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    await cryptoWaitReady();

    const args = process.argv.slice(2);

    let startNode, endNode, funderSeed;

    if (args.length === 0) {
        // Auto-mode: read .last_nodes
        const saved = readLastNodes();
        if (!saved) {
            console.log('');
            console.log('No arguments given and no .last_nodes state file found.');
            console.log('');
            console.log('Scanning for running extra nodes...');
            const running = await scanRunningNodes();
            if (running.length === 0) {
                console.error('No extra nodes found running. Start them first with:');
                console.error('  ./run_n_nodes.sh <count>');
                process.exit(1);
            }
            console.log(`Found running extra nodes: ${running.map(n => `n${n.index}(ws:${n.wsPort})`).join(', ')}`);
            startNode = running[0].index;
            endNode = running[running.length - 1].index;
        } else {
            startNode = saved.start;
            endNode = saved.end;
            console.log(`Auto-detected from .last_nodes: n${startNode} → n${endNode}`);
        }
        funderSeed = 'neutral mother faculty picnic stand ill virtual donkey later clinic aim chronic';
    } else if (args.length >= 2) {
        startNode = parseInt(args[0], 10);
        endNode = parseInt(args[1], 10);
        funderSeed = args[2] || 'neutral mother faculty picnic stand ill virtual donkey later clinic aim chronic';
    } else {
        console.error('Usage: node validators.js [start_index end_index] ["funder_seed"]');
        console.error('   or: node validators.js              ← auto-detects from .last_nodes');
        process.exit(1);
    }

    if (isNaN(startNode) || isNaN(endNode) || startNode > endNode || startNode < 1) {
        console.error('Error: Invalid node range. Both must be positive integers with start ≤ end.');
        process.exit(1);
    }

    const keyring = new Keyring({ type: 'sr25519' });
    const funder = keyring.addFromUri(funderSeed);

    console.log('');
    console.log(`Validator range  : n${startNode} → n${endNode}`);
    console.log(`Funder account   : ${funder.address}`);
    console.log('');

    // Pre-flight: verify all requested nodes are actually running BEFORE starting
    console.log('Pre-flight: checking all node WS ports are reachable...');
    for (let i = startNode; i <= endNode; i++) {
        const wsPort = 9944 + i;
        try {
            await checkPortOpen('127.0.0.1', wsPort, 5000);
            console.log(`  ✓ n${i} is reachable on ws://127.0.0.1:${wsPort}`);
        } catch (e) {
            console.error('');
            console.error(`  ✗ n${i} is NOT reachable on ws://127.0.0.1:${wsPort}`);
            console.error(`    Make sure it is running. Check with: ps aux | grep reef-node`);
            console.error(`    To start extra nodes: ./run_n_nodes.sh <count>`);
            process.exit(1);
        }
    }
    console.log('');

    // Connect to main node (n1, alwa 
    // ys ws 9944)
    console.log('Connecting to main node (ws://127.0.0.1:9944) ...');
    const mainWs = new WsProvider('ws://127.0.0.1:9944');
    const mainApi = await ApiPromise.create({ provider: mainWs });

    const { data: funderBal } = await mainApi.query.system.account(funder.address);
    console.log(`Funder balance   : ${funderBal.free.toHuman()}`);

    if (funderBal.free.isZero()) {
        console.error('Error: Funder account has 0 balance. Provide a funded seed as 3rd argument.');
        await mainApi.disconnect();
        process.exit(1);
    }

    const FUND_AMOUNT = BigInt('2000000' + '0'.repeat(18)); // 2M REEF
    const BOND_AMOUNT = BigInt('1000000' + '0'.repeat(18)); // 1M REEF

    // ── Process each node ──────────────────────────────────────────────────
    for (let i = startNode; i <= endNode; i++) {
        const wsPort = 9944 + i;

        console.log('');
        console.log(`${'═'.repeat(52)}`);
        console.log(`  Node n${i}  (ws://127.0.0.1:${wsPort})`);
        console.log(`${'═'.repeat(52)}`);

        // Step 1: New stash account
        const mnemonic = mnemonicGenerate();
        const stash = keyring.addFromUri(mnemonic);
        console.log(`Step 1 | Stash   : ${stash.address}`);
        console.log(`         Mnemonic: ${mnemonic}`);
        console.log(`         ⚠  SAVE THIS MNEMONIC — it controls the validator stake.`);

        // Step 2: Fund from funder
        console.log(`Step 2 | Funding stash (2M REEF) from funder...`);
        await waitInBlock(
            mainApi,
            mainApi.tx.balances.transferKeepAlive(stash.address, FUND_AMOUNT.toString()),
            funder,
            `Fund n${i}`
        );

        // Step 3: Rotate session keys on this specific node
        console.log(`Step 3 | Rotating session keys on ws://127.0.0.1:${wsPort}...`);
        const nodeWs = new WsProvider(`ws://127.0.0.1:${wsPort}`);
        const nodeApi = await Promise.race([
            ApiPromise.create({ provider: nodeWs }),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`API init timed out for n${i}`)), 20000))
        ]);
        const sessionKeys = await nodeApi.rpc.author.rotateKeys();
        console.log(`         Keys    : ${sessionKeys.toHex()}`);
        await nodeApi.disconnect();

        // Step 4: bond + setKeys + validate batch
        console.log(`Step 4 | Submitting bond + setKeys + validate...`);
        const bondTx = mainApi.tx.staking.bond.meta.args.length >= 3
            ? mainApi.tx.staking.bond(stash.address, BOND_AMOUNT.toString(), 'Staked')
            : mainApi.tx.staking.bond(BOND_AMOUNT.toString(), 'Staked');

        const setKeysTx = mainApi.tx.session.setKeys(sessionKeys.toHex(), '0x');
        const validateTx = mainApi.tx.staking.validate({ commission: 0 });

        await waitInBlock(
            mainApi,
            mainApi.tx.utility.batchAll([bondTx, setKeysTx, validateTx]),
            stash,
            `Register n${i} as validator`
        );

        console.log(`  ✓ n${i} successfully queued as validator!`);
    }

    await mainApi.disconnect();

    // Clear .last_nodes so it doesn't get accidentally reused
    const stateFile = path.join(__dirname, '.last_nodes');
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    console.log('');
    console.log('═'.repeat(52));
    console.log('  All done! Nodes will become active at next session.');
    console.log('═'.repeat(52));
    process.exit(0);
}

main().catch(err => {
    console.error('');
    console.error('Fatal error:', err.message);
    process.exit(1);
});
