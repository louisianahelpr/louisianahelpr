#!/bin/zsh
# usage: d.sh <port> '<js body>'
curl -s "localhost:$1" --data-binary "$2"; echo
