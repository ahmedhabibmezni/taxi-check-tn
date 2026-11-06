#!/usr/bin/env bash
# Uses existing tools only; starts an isolated synthetic cluster, never a system service.
set -eu
pg_bin=${CARD_TEST_PG_BINDIR:-/usr/lib/postgresql/16/bin}
node_bin=${CARD_TEST_NODE:-node}
"$node_bin" -e 'if(process.platform!=="linux" || Number(process.versions.node.split(".")[0])!==24)process.exit(1)'
mkdir -p "$HOME/.local/share/taxi-check-pg-tests"
run=$(mktemp -d "$HOME/.local/share/taxi-check-pg-tests/run.XXXXXX")
mkdir "$run/socket" "$run/tmp"
extra=()
if [ -n "${CARD_TEST_PG_SHARE:-}" ]; then extra=(-L "$CARD_TEST_PG_SHARE"); fi
"$pg_bin/initdb" -D "$run/data" "${extra[@]}" --no-locale --encoding=UTF8 --auth-local=trust --auth-host=trust -U tc_test_admin > "$run/init.log"
"$pg_bin/pg_ctl" -D "$run/data" -l "$run/postgres.log" -o "-k $run/socket -p 55439 -h 127.0.0.1 -c shared_buffers=32MB -c max_connections=24 -c log_statement=none -c log_min_error_statement=panic -c log_parameter_max_length_on_error=0" -w start
trap '"$pg_bin/pg_ctl" -D "$run/data" -m fast -w stop' EXIT
printf 'Dedicated synthetic evidence directory: %s\n' "$run"
df -T "$run/data" "$run/tmp"
CARD_TEST_PG_CTL="$pg_bin/pg_ctl" CARD_TEST_PG_DATA="$run/data" CARD_TEST_PG_LIB="${LD_LIBRARY_PATH:-}" \
  CARD_TEST_DATABASE_URL=postgresql://tc_test_admin@127.0.0.1:55439/postgres TMPDIR="$run/tmp" \
  "$node_bin" --test --test-concurrency=1 service/*.test.mjs
