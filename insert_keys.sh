#!/bin/bash

# Define the base command for inserting keys
INSERT_CMD="./target/release/reef-node key insert --chain ./customSpecRaw.json"

# Validator 1 Keys
echo "Inserting keys for Node 1 (n1)..."
PHRASE_1="neutral mother faculty picnic stand ill virtual donkey later clinic aim chronic"
$INSERT_CMD --base-path n1 --scheme Sr25519 --suri "$PHRASE_1" --key-type babe
$INSERT_CMD --base-path n1 --scheme Ed25519 --suri "$PHRASE_1" --key-type gran
$INSERT_CMD --base-path n1 --scheme Sr25519 --suri "$PHRASE_1" --key-type imon
$INSERT_CMD --base-path n1 --scheme Sr25519 --suri "$PHRASE_1" --key-type audi
echo "Node 1 keys inserted."

# Validator 2 Keys
echo -e "\nInserting keys for Node 2 (n2)..."
PHRASE_2="match wife undo interest section peasant energy maple balcony unhappy romance layer"
$INSERT_CMD --base-path n2 --scheme Sr25519 --suri "$PHRASE_2" --key-type babe
$INSERT_CMD --base-path n2 --scheme Ed25519 --suri "$PHRASE_2" --key-type gran
$INSERT_CMD --base-path n2 --scheme Sr25519 --suri "$PHRASE_2" --key-type imon
$INSERT_CMD --base-path n2 --scheme Sr25519 --suri "$PHRASE_2" --key-type audi
echo "Node 2 keys inserted."

# Validator 3 Keys
echo -e "\nInserting keys for Node 3 (n3)..."
PHRASE_3="choice exhaust hold nice can bridge own crash clerk tube bomb oven"
$INSERT_CMD --base-path n3 --scheme Sr25519 --suri "$PHRASE_3" --key-type babe
$INSERT_CMD --base-path n3 --scheme Ed25519 --suri "$PHRASE_3" --key-type gran
$INSERT_CMD --base-path n3 --scheme Sr25519 --suri "$PHRASE_3" --key-type imon
$INSERT_CMD --base-path n3 --scheme Sr25519 --suri "$PHRASE_3" --key-type audi
echo "Node 3 keys inserted."

echo -e "\nAll session keys have been successfully inserted into the nodes' keystores!"
