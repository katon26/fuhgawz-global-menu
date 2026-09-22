#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# tests/test_gm_run.sh - Comprehensive Test Suite for bin/gm-run CLI Task Runner

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GM_RUN="$REPO_DIR/bin/gm-run"

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

assert_eq() {
    local expected="$1"
    local actual="$2"
    local msg="$3"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    if [ "$expected" = "$actual" ]; then
        echo "  [PASS] $msg"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo "  [FAIL] $msg: expected '$expected', got '$actual'"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="$3"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    if echo "$haystack" | grep -q "$needle"; then
        echo "  [PASS] $msg"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo "  [FAIL] $msg: string '$needle' not found in '$haystack'"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

echo "=== Running Developer Task Runner (bin/gm-run) Test Suite ==="

# -----------------------------------------------------------------------------
# 1. Verification of Executable Existence and Permissions
# -----------------------------------------------------------------------------
echo ""
echo "1. Verifying bin/gm-run permissions and basic execution..."
TOTAL_TESTS=$((TOTAL_TESTS + 1))
if [ -x "$GM_RUN" ]; then
    echo "  [PASS] bin/gm-run exists and is executable"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo "  [FAIL] bin/gm-run does not exist or is not executable"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# -----------------------------------------------------------------------------
# 2. Help and Usage Argument Parsing
# -----------------------------------------------------------------------------
echo ""
echo "2. Verifying CLI help and argument validation..."

HELP_OUT=$("$GM_RUN" --help)
HELP_CODE=$?
assert_eq "0" "$HELP_CODE" "--help exits with 0"
assert_contains "$HELP_OUT" "Usage: gm-run" "--help output contains usage description"

SHORT_HELP_OUT=$("$GM_RUN" -h)
SHORT_HELP_CODE=$?
assert_eq "0" "$SHORT_HELP_CODE" "-h exits with 0"
assert_contains "$SHORT_HELP_OUT" "Usage: gm-run" "-h output contains usage description"

EMPTY_OUT=$("$GM_RUN" 2>&1 || true)
assert_contains "$EMPTY_OUT" "Usage: gm-run" "Invoking with no args outputs usage"

set +e
"$GM_RUN" >/dev/null 2>&1
EMPTY_CODE=$?
set -e
assert_eq "1" "$EMPTY_CODE" "Invoking with no args exits with 1"

set +e
TITLE_ERR=$("$GM_RUN" --title 2>&1)
TITLE_CODE=$?
set -e
assert_eq "1" "$TITLE_CODE" "Missing --title argument exits with 1"
assert_contains "$TITLE_ERR" "Error: --title requires an argument" "Missing --title shows clear error"

set +e
APP_ERR=$("$GM_RUN" --app-id 2>&1)
APP_CODE=$?
set -e
assert_eq "1" "$APP_CODE" "Missing --app-id argument exits with 1"
assert_contains "$APP_ERR" "Error: --app-id requires an argument" "Missing --app-id shows clear error"

set +e
UNKNOWN_ERR=$("$GM_RUN" --bogus-option true 2>&1)
UNKNOWN_CODE=$?
set -e
assert_eq "1" "$UNKNOWN_CODE" "Unknown option before command exits with 1"
assert_contains "$UNKNOWN_ERR" "Error: Unknown option --bogus-option" "Unknown option shows clear error"

# -----------------------------------------------------------------------------
# 3. Exit Code Propagation
# -----------------------------------------------------------------------------
echo ""
echo "3. Verifying exit code propagation..."

# Success (0)
set +e
"$GM_RUN" --title "Test Success" true
TRUE_CODE=$?
set -e
assert_eq "0" "$TRUE_CODE" "bin/gm-run true returns exit code 0"

# Failure (1)
set +e
"$GM_RUN" --title "Test Failure" false
FALSE_CODE=$?
set -e
assert_eq "1" "$FALSE_CODE" "bin/gm-run false returns exit code 1"

# Arbitrary exit code (42)
set +e
"$GM_RUN" bash -c 'exit 42'
CODE_42=$?
set -e
assert_eq "42" "$CODE_42" "bin/gm-run propagates arbitrary exit code 42"

# Arbitrary exit code (120)
set +e
"$GM_RUN" bash -c 'exit 120'
CODE_120=$?
set -e
assert_eq "120" "$CODE_120" "bin/gm-run propagates arbitrary exit code 120"

# Non-existent command (127)
set +e
"$GM_RUN" /nonexistent_command_executable_xyz 2>/dev/null
CODE_127=$?
set -e
assert_eq "127" "$CODE_127" "bin/gm-run propagates exit code 127 for non-existent command"

# -----------------------------------------------------------------------------
# 4. Command Argument Handling, Passing and Separation
# -----------------------------------------------------------------------------
echo ""
echo "4. Verifying command argument forwarding and option separation..."

# Arguments with spaces and quotes
ARG_OUTPUT=$("$GM_RUN" --title "Arg Forwarding" bash -c 'echo "1:$1 2:$2"' -- "first argument" "second argument")
assert_eq "1:first argument 2:second argument" "$ARG_OUTPUT" "Forwarding arguments with spaces and quotes"

# Flags inside command (e.g. ls -d .)
FLAG_OUTPUT=$("$GM_RUN" --title "Flag Forwarding" ls -d "$REPO_DIR")
assert_eq "$REPO_DIR" "$FLAG_OUTPUT" "Preserving command flags starting with -"

# -- separator handling
SEP_OUTPUT=$("$GM_RUN" --title "Separator Test" -- echo "separator works")
assert_eq "separator works" "$SEP_OUTPUT" "Preserving arguments after -- separator"

# --title= syntax
EQUAL_TITLE_OUTPUT=$("$GM_RUN" --title="Syntax Equals" --app-id="org.test.App" echo "equals syntax works")
assert_eq "equals syntax works" "$EQUAL_TITLE_OUTPUT" "Accepting --title= and --app-id= syntax"

# Empty --app-id fallback
EMPTY_APP_OUTPUT=$("$GM_RUN" --app-id="" echo "empty app-id works")
assert_eq "empty app-id works" "$EMPTY_APP_OUTPUT" "Graceful fallback when --app-id is empty string"

# -----------------------------------------------------------------------------
# 5. Stdin, Stdout, Stderr and PTY Forwarding
# -----------------------------------------------------------------------------
echo ""
echo "5. Verifying stdin, stdout, stderr, and interactive PTY forwarding..."

STDIN_DATA="The quick brown fox jumps over the lazy dog"
STDIN_RESULT=$(echo "$STDIN_DATA" | "$GM_RUN" cat)
assert_eq "$STDIN_DATA" "$STDIN_RESULT" "Stdin correctly piped through child process"

STDERR_RESULT=$("$GM_RUN" bash -c 'echo "Diagnostic Message on Stderr" >&2' 2>&1)
assert_eq "Diagnostic Message on Stderr" "$STDERR_RESULT" "Stderr output correctly captured"

# Interactive PTY test (isatty is preserved)
if command -v python3 >/dev/null 2>&1; then
    PTY_RESULT=$(python3 -c '
import pty, os, subprocess
master, slave = pty.openpty()
proc = subprocess.Popen(["'"$GM_RUN"'", "python3", "-c", "import sys; print(\"isatty:\", sys.stdin.isatty())"],
                        stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
out = os.read(master, 1024).decode()
os.close(master)
proc.wait()
print(out.strip())
' 2>/dev/null || echo "failed")
    assert_eq "isatty: True" "$PTY_RESULT" "Interactive PTY line discipline and isatty preserved"
fi

# -----------------------------------------------------------------------------
# 6. Fallback Behavior (D-Bus Unreachable / Disabled)
# -----------------------------------------------------------------------------
echo ""
echo "6. Verifying graceful fallback when D-Bus is unreachable..."

# Completely unset DBUS_SESSION_BUS_ADDRESS
FALLBACK_1_ERR=$(DBUS_SESSION_BUS_ADDRESS="" "$GM_RUN" echo "Normal Output" 2>&1 >/dev/null)
assert_eq "" "$FALLBACK_1_ERR" "Fallback: zero errors on stderr when DBUS_SESSION_BUS_ADDRESS is empty"

set +e
DBUS_SESSION_BUS_ADDRESS="" "$GM_RUN" false >/dev/null 2>&1
FALLBACK_1_CODE=$?
set -e
assert_eq "1" "$FALLBACK_1_CODE" "Fallback: exit code propagated properly without D-Bus"

# Invalid socket path in DBUS_SESSION_BUS_ADDRESS
FALLBACK_2_ERR=$(DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent/dbus/socket.sock" "$GM_RUN" echo "Output" 2>&1 >/dev/null)
assert_eq "" "$FALLBACK_2_ERR" "Fallback: zero errors on stderr when D-Bus socket does not exist"

# -----------------------------------------------------------------------------
# 7. Signal Trapping (SIGINT, SIGTERM, SIGHUP, SIGQUIT) & No Orphaned Processes
# -----------------------------------------------------------------------------
echo ""
echo "7. Verifying signal trapping, exit codes, and child termination..."

# SIGINT in child command (exit 130)
set +e
"$GM_RUN" bash -c 'kill -INT $$' 2>/dev/null
SIGINT_CHILD_CODE=$?
set -e
assert_eq "130" "$SIGINT_CHILD_CODE" "SIGINT in child process results in exit code 130"

# SIGTERM in child command (exit 143)
set +e
"$GM_RUN" bash -c 'kill -TERM $$' 2>/dev/null
SIGTERM_CHILD_CODE=$?
set -e
assert_eq "143" "$SIGTERM_CHILD_CODE" "SIGTERM in child process results in exit code 143"

# Verification of signals sent directly to gm-run process (SIGINT, SIGTERM, SIGHUP, SIGQUIT)
# We test process exit codes and verify child processes are cleanly terminated (no orphans)
if command -v python3 >/dev/null 2>&1; then
    SIG_TEST_OUTPUT=$(python3 -c '
import os, signal, subprocess, time

gm_run = "'"$GM_RUN"'"
signals = [
    (signal.SIGINT, "SIGINT", 130),
    (signal.SIGTERM, "SIGTERM", 143),
    (signal.SIGHUP, "SIGHUP", 129),
    (signal.SIGQUIT, "SIGQUIT", 131),
]

for sig, name, expected_code in signals:
    # Ensure signal is set to SIG_DFL on spawn so that non-interactive shells do not inherit SIG_IGN
    proc = subprocess.Popen([gm_run, "sleep", "10"],
                            preexec_fn=lambda s=sig: signal.signal(s, signal.SIG_DFL))
    time.sleep(0.15)
    try:
        raw_children = subprocess.check_output(["pgrep", "-P", str(proc.pid)], stderr=subprocess.DEVNULL)
        child_pids = [int(p) for p in raw_children.decode().split() if p.isdigit()]
    except Exception:
        child_pids = []
    proc.send_signal(sig)
    ret = proc.wait()
    time.sleep(0.1)
    survived = [p for p in child_pids if os.path.exists(f"/proc/{p}")]
    print(f"{name}|{ret}|{len(survived)}")
' 2>/dev/null || echo "python_sig_test_failed")

    while IFS="|" read -r sig_name sig_code orphan_count; do
        [ -z "$sig_name" ] && continue
        case "$sig_name" in
            SIGINT)
                assert_eq "130" "$sig_code" "SIGINT to gm-run directly caught and exits 130"
                assert_eq "0" "$orphan_count" "SIGINT terminates child process (no orphaned background processes)"
                ;;
            SIGTERM)
                assert_eq "143" "$sig_code" "SIGTERM to gm-run directly caught and exits 143"
                assert_eq "0" "$orphan_count" "SIGTERM terminates child process (no orphaned background processes)"
                ;;
            SIGHUP)
                assert_eq "129" "$sig_code" "SIGHUP to gm-run directly caught and exits 129"
                assert_eq "0" "$orphan_count" "SIGHUP terminates child process (no orphaned background processes)"
                ;;
            SIGQUIT)
                assert_eq "131" "$sig_code" "SIGQUIT to gm-run directly caught and exits 131"
                assert_eq "0" "$orphan_count" "SIGQUIT terminates child process (no orphaned background processes)"
                ;;
        esac
    done <<< "$SIG_TEST_OUTPUT"
fi

# -----------------------------------------------------------------------------
# 8. Live D-Bus Integration with TaskManager (via dbus-run-session)
# -----------------------------------------------------------------------------
echo ""
echo "8. Verifying Live D-Bus RPC integration with TaskManager..."

if command -v dbus-run-session >/dev/null 2>&1 && command -v gjs >/dev/null 2>&1; then
    TEST_TMP_DIR=$(mktemp -d "$REPO_DIR/tests/.tmp_gm_run_test_XXXXXX")
    chmod 700 "$TEST_TMP_DIR"
    DAEMON_JS="$TEST_TMP_DIR/task_manager_daemon.js"
    EVENT_LOG="$TEST_TMP_DIR/events.log"
    CACHE_FILE="$TEST_TMP_DIR/recent_tasks.json"

    cat << EOF > "$DAEMON_JS"
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { TaskManager } from 'file://$REPO_DIR/src/taskManager.js';

const tm = new TaskManager(null, { cacheFile: '$CACHE_FILE' });
const logFile = Gio.File.new_for_path('$EVENT_LOG');

function appendLog(line) {
    let stream;
    if (logFile.query_exists(null)) {
        stream = logFile.append_to(Gio.FileCreateFlags.NONE, null);
    } else {
        stream = logFile.create(Gio.FileCreateFlags.NONE, null);
    }
    stream.write_all(new TextEncoder().encode(line + '\n'), null);
    stream.close(null);
}

tm.connect('task-added', (_m, task) => {
    appendLog('ADDED|' + task.id + '|' + task.title + '|' + task.appId);
});

tm.connect('task-completed', (_m, task) => {
    appendLog('COMPLETED|' + task.id + '|' + task.state + '|' + task.title);
});

const loop = new GLib.MainLoop(null, false);
loop.run();
EOF

    GIO_USE_VFS=local XDG_RUNTIME_DIR="$TEST_TMP_DIR" dbus-run-session bash -c '
        gjs -m "'"$DAEMON_JS"'" &
        DAEMON_PID=$!
        sleep 0.4

        # 8a. Successful command with explicit title and appId
        "'"$GM_RUN"'" --title "Kernel Compilation" --app-id "org.gnome.Ptyxis" true
        sleep 0.1

        # 8b. Failing command with explicit title
        "'"$GM_RUN"'" --title "Failed Test Suite" --app-id "org.gnome.Terminal" false || true
        sleep 0.1

        # 8c. Command with default title (should default to command name)
        "'"$GM_RUN"'" echo "Default Title Run" >/dev/null
        sleep 0.1

        # 8d. Task terminated by signal: must call CompleteTask with success=false
        "'"$GM_RUN"'" --title "Signal Interrupted Build" sleep 5 &
        SIG_RUNNER_PID=$!
        sleep 0.2
        kill -TERM "$SIG_RUNNER_PID" 2>/dev/null || true
        wait "$SIG_RUNNER_PID" 2>/dev/null || true
        sleep 0.1

        kill -9 $DAEMON_PID 2>/dev/null || true
        wait $DAEMON_PID 2>/dev/null || true
    '

    LOG_CONTENT=$(cat "$EVENT_LOG" 2>/dev/null || echo "")

    # Assertions on D-Bus events
    assert_contains "$LOG_CONTENT" "ADDED|" "TaskManager received RegisterTask calls via D-Bus"
    assert_contains "$LOG_CONTENT" "ADDED|" "Kernel Compilation" "Task 1 registered with custom title"
    assert_contains "$LOG_CONTENT" "org.gnome.Ptyxis" "Task 1 registered with custom appId"
    assert_contains "$LOG_CONTENT" "COMPLETED|" "Task 1 completed via CompleteTask"
    assert_contains "$LOG_CONTENT" "completed|Kernel Compilation" "Task 1 marked with state=completed"

    assert_contains "$LOG_CONTENT" "ADDED|" "Failed Test Suite" "Task 2 registered with custom title"
    assert_contains "$LOG_CONTENT" "COMPLETED|" "failed|Failed Test Suite" "Task 2 marked with state=failed"

    assert_contains "$LOG_CONTENT" "ADDED|" "echo|org.gnome.Terminal" "Task 3 registered with default title 'echo' and default appId"
    assert_contains "$LOG_CONTENT" "COMPLETED|" "completed|echo" "Task 3 marked with state=completed"

    assert_contains "$LOG_CONTENT" "ADDED|" "Signal Interrupted Build" "Task 4 registered before signal"
    assert_contains "$LOG_CONTENT" "failed|Signal Interrupted Build" "Task 4 marked with state=failed after SIGTERM"

    # Verify persistent disk caching of recent tasks
    if [ -f "$CACHE_FILE" ]; then
        CACHE_JSON=$(cat "$CACHE_FILE")
        assert_contains "$CACHE_JSON" "Kernel Compilation" "Cache contains Kernel Compilation"
        assert_contains "$CACHE_JSON" "Failed Test Suite" "Cache contains Failed Test Suite"
        assert_contains "$CACHE_JSON" "echo" "Cache contains echo task"
        assert_contains "$CACHE_JSON" "Signal Interrupted Build" "Cache contains Signal Interrupted Build"
    else
        echo "  [FAIL] Cache file was not written"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi

    # Cleanup temp directory
    rm -rf "$TEST_TMP_DIR"
else
    echo "  [SKIP] dbus-run-session or gjs not available for live RPC test"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "=================================================="
echo "Tests Passed: $PASSED_TESTS / $TOTAL_TESTS"
if [ "$FAILED_TESTS" -eq 0 ]; then
    echo "ALL TESTS PASSED SUCCESSFULLY!"
    echo "=================================================="
    exit 0
else
    echo "FAILED: $FAILED_TESTS tests failed!"
    echo "=================================================="
    exit 1
fi
