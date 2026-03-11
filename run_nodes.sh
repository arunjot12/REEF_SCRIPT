#!/bin/bash

# Kill any existing nodes before starting new ones
killall reef-node 2>/dev/null

if [ "$1" == "restart" ]; then
    echo "Purging old chain states..."
    ./target/release/reef-node purge-chain --base-path n1 --chain ./customSpecRaw.json -y 2>/dev/null
    ./target/release/reef-node purge-chain --base-path n2 --chain ./customSpecRaw.json -y 2>/dev/null
    ./target/release/reef-node purge-chain --base-path n3 --chain ./customSpecRaw.json -y 2>/dev/null
    ./insert_keys.sh

    # Clear logs for all extra nodes (n4, n5, n6, ...)
    echo "Clearing extra node logs..."
    for logfile in n{4..99}.log; do
        [ -f "$logfile" ] && > "$logfile" && echo "  cleared $logfile"
    done

    # Clear validator state file so validators.js doesn't reuse stale data
    [ -f ".last_nodes" ] && rm -f .last_nodes && echo "  cleared .last_nodes"
else
    echo "Starting existing databases..."
fi

echo "Starting Node 1 (n1)..."
> n1.log

./target/release/reef-node \
  --base-path n1 \
  --chain customSpecRaw.json \
  --port 30333 \
  --ws-port 9944 \
  --rpc-port 9933 \
  --no-telemetry \
  --ws-external \
  --validator \
  --rpc-methods Unsafe \
  --name n1 \
  --rpc-cors all \
  --rpc-external \
  >> n1.log 2>&1 &

echo "Waiting for Node 1 to expose its local identity..."

# Wait up to 30 seconds for Node 1 to output its peer ID
TIMEOUT=30
COUNT=0
while ! grep -q "Local node identity is:" n1.log; do
    sleep 1
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -ge "$TIMEOUT" ]; then
        echo "Error: Timeout waiting for Node 1 identity."
        exit 1
    fi
done

PEER_ID=$(grep "Local node identity is:" n1.log | awk '{print $NF}')
BOOTNODE="/ip4/127.0.0.1/tcp/30333/p2p/$PEER_ID"

echo "Node 1 identity found: $PEER_ID"
echo "Nodes 2 and 3 will connect to: $BOOTNODE"

echo "Starting Node 2 (n2)..."
./target/release/reef-node \
  --base-path n2 \
  --chain ./customSpecRaw.json \
  --port 30334 \
  --ws-port 9945 \
  --rpc-port 9934 \
  --no-telemetry \
  --validator \
  --rpc-cors all \
  --ws-external \
  --rpc-external \
  --rpc-methods Unsafe \
  --name n2 \
  --bootnodes "$BOOTNODE" \
  > n2.log 2>&1 &

echo "Starting Node 3 (n3)..."
./target/release/reef-node \
  --base-path n3 \
  --chain ./customSpecRaw.json \
  --port 30335 \
  --ws-port 9946 \
  --rpc-port 9935 \
  --no-telemetry \
  --validator \
  --ws-external \
  --rpc-cors all \
  --rpc-external \
  --rpc-methods Unsafe \
  --name n3 \
  --bootnodes "$BOOTNODE" \
  > n3.log 2>&1 &

echo "---------------------------------------------------------"
echo "All three nodes have been started in the background!"
echo "Their logs are being written to n1.log, n2.log, and n3.log"
echo "---------------------------------------------------------"
echo "Commands to view logs:"
echo "  tail -f n1.log"
echo "  tail -f n2.log"
echo "  tail -f n3.log"
echo ""
echo "To stop all the nodes, run:"
echo "  killall reef-node"
