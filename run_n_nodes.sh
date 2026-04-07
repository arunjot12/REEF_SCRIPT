#!/bin/bash
# run_n_nodes.sh
# Usage: ./run_n_nodes.sh [--purge] <N>
#
#   Starts N *additional* reef-node validators on top of however many are already running.
#   Port layout (same as run_nodes.sh):
#     Node i → p2p port  = 30332 + i
#              rpc port  = 9943  + i
#
#   --purge   Delete the base-path directory and log file for each new node
#             before starting it (clean slate). Without this flag, existing
#             chain data is reused.
#
# Example (3 nodes already running):
#   ./run_n_nodes.sh 5          # adds n4..n8, reuses existing chain data
#   ./run_n_nodes.sh --purge 5  # adds n4..n8, wiping their data first

set -euo pipefail

# ── 1. Parse arguments ────────────────────────────────────────────────────────
PURGE=false

usage() {
    echo "Usage: $0 [--purge] <number_of_extra_nodes>"
    echo "  --purge   Wipe base-path & log for each new node before starting"
    echo "  e.g.  $0 5          # add 5 nodes, keep existing chain data"
    echo "        $0 --purge 5  # add 5 nodes, delete their data first"
    exit 1
}

if [ "${1:-}" == "--purge" ]; then
    PURGE=true
    shift
fi

if [ -z "${1:-}" ]; then
    usage
fi

N="$1"
if ! [[ "$N" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: argument must be a positive integer, got: '$N'"
    exit 1
fi

# ── 2. Detect currently running nodes ────────────────────────────────────────
EXISTING=$(pgrep -af "reef-node" 2>/dev/null | grep -o "\-\-name n[0-9]*" | grep -o "n[0-9]*" | sort -V | tail -1)

if [ -z "$EXISTING" ]; then
    echo "Error: No reef-node processes detected. Start base nodes first with run_nodes.sh."
    exit 1
fi

LAST_NUM=$(echo "$EXISTING" | grep -o "[0-9]*$")
FIRST_NEW=$((LAST_NUM + 1))
LAST_NEW=$((LAST_NUM + N))

echo "Highest running node : n${LAST_NUM}  (rpc-port $((9943 + LAST_NUM)))"
echo "Nodes to start       : n${FIRST_NEW} .. n${LAST_NEW}"
[ "$PURGE" == "true" ] && echo "Mode                 : --purge (existing chain data will be DELETED)"
echo ""

# ── 3. Resolve paths & detect chain spec from running n1 ─────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N1_LOG="$SCRIPT_DIR/n1.log"

if [ ! -f "$N1_LOG" ]; then
    echo "Error: n1.log not found at $N1_LOG. Cannot determine bootnode."
    exit 1
fi

# Auto-detect the exact --chain argument n1 was launched with.
# This guarantees every extra node uses the SAME genesis as the running chain.
N1_PID=$(pgrep -f "reef-node.*--name n1" | head -1)
if [ -n "$N1_PID" ]; then
    CHAIN_SPEC=$(tr '\0' '\n' < /proc/${N1_PID}/cmdline | grep -A1 "^--chain$" | tail -1)
    # If it's a relative path, resolve it from n1's working directory
    if [[ "$CHAIN_SPEC" != /* ]]; then
        N1_CWD=$(readlink -f /proc/${N1_PID}/cwd)
        CHAIN_SPEC="${N1_CWD}/${CHAIN_SPEC}"
    fi
    echo "Chain spec (detected from n1 process): $CHAIN_SPEC"
else
    # Fallback: use the spec in SCRIPT_DIR
    CHAIN_SPEC="${SCRIPT_DIR}/customSpecRaw.json"
    echo "Warning: n1 process not found; falling back to $CHAIN_SPEC"
fi

if [ ! -f "$CHAIN_SPEC" ]; then
    echo "Error: Chain spec not found at $CHAIN_SPEC"
    exit 1
fi

PEER_ID=$(grep "Local node identity is:" "$N1_LOG" | awk '{print $NF}' | tail -1)
if [ -z "$PEER_ID" ]; then
    echo "Error: Could not find peer ID in n1.log."
    exit 1
fi

BOOTNODE="/ip4/127.0.0.1/tcp/30333/p2p/$PEER_ID"
echo "Bootnode: $BOOTNODE"
echo ""

# ── 4. Start the extra nodes ──────────────────────────────────────────────────
for i in $(seq 1 "$N"); do
    NODE_NUM=$((LAST_NUM + i))
    NODE_NAME="n${NODE_NUM}"
    BASE_PATH="${SCRIPT_DIR}/${NODE_NAME}"
    P2P_PORT=$((30332 + NODE_NUM))
    RPC_PORT=$((9943  + NODE_NUM))
    LOG_FILE="${SCRIPT_DIR}/${NODE_NAME}.log"

    # ── Purge if requested ───────────────────────────────────────────────────
    if [ "$PURGE" == "true" ]; then
        if [ -d "$BASE_PATH" ]; then
            echo "  [purge] Deleting $BASE_PATH"
            rm -rf "$BASE_PATH"
        fi
        if [ -f "$LOG_FILE" ]; then
            echo "  [purge] Clearing $LOG_FILE"
            > "$LOG_FILE"
        fi
    fi

    echo "Starting ${NODE_NAME}  (p2p: ${P2P_PORT}, rpc: ${RPC_PORT}) → ${LOG_FILE}"

    "$SCRIPT_DIR/target/release/reef-node" \
        --base-path "${BASE_PATH}" \
        --chain "${CHAIN_SPEC}" \
        --port  "${P2P_PORT}" \
        --rpc-port "${RPC_PORT}" \
        --no-telemetry \
        --validator \
        --rpc-cors all \
        --rpc-external \
        --rpc-methods Unsafe \
        --name "${NODE_NAME}" \
        --bootnodes "${BOOTNODE}" \
        > "${LOG_FILE}" 2>&1 &

    echo "  PID: $!"
done

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "Started $N extra node(s)  (n${FIRST_NEW} .. n${LAST_NEW})"
echo ""
echo "View logs:"
for i in $(seq 1 "$N"); do
    NODE_NUM=$((LAST_NUM + i))
    echo "  tail -f ${SCRIPT_DIR}/n${NODE_NUM}.log"
done
echo ""
echo "Stop all nodes:  killall reef-node"
echo "─────────────────────────────────────────────────────────────"
