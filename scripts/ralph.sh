#!/bin/bash

# Wintermute Ralph Execution Script
# ==================================
# Runs the Ralph loop for automated task execution.
#
# Usage:
#   ./ralph.sh              # Run one iteration
#   ./ralph.sh --loop       # Run continuously until all tasks done
#   ./ralph.sh --status     # Show current progress
#   ./ralph.sh --next       # Show next ready task

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TASKS_FILE="$PROJECT_ROOT/tasks/ralph-tasks.md"
PROGRESS_FILE="$PROJECT_ROOT/scripts/ralph/progress.txt"
COMPLETED_FILE="$PROJECT_ROOT/scripts/ralph/completed-tasks.txt"
TIMEOUT_SECONDS=240

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Initialize completed tasks file if it doesn't exist
if [[ ! -f "$COMPLETED_FILE" ]]; then
    touch "$COMPLETED_FILE"
fi

# Get all task IDs from the tasks file
get_all_tasks() {
    grep -E "^### P[0-9]+-[0-9]+:" "$TASKS_FILE" | sed 's/### \(P[0-9]*-[0-9]*\):.*/\1/'
}

# Get dependencies for a task
get_dependencies() {
    local task_id="$1"
    # Find the task section and extract depends on line
    awk "/^### $task_id:/{found=1} found && /\*\*Depends on:\*\*/{print; exit}" "$TASKS_FILE" | \
        sed 's/.*\*\*Depends on:\*\* //' | \
        sed 's/Nothing//' | \
        sed 's/,/ /g' | \
        tr -d '\r'
}

# Check if a task is completed
is_completed() {
    local task_id="$1"
    grep -q "^$task_id$" "$COMPLETED_FILE" 2>/dev/null
}

# Check if all dependencies are satisfied
dependencies_satisfied() {
    local task_id="$1"
    local deps=$(get_dependencies "$task_id")
    
    # No dependencies = satisfied
    if [[ -z "$deps" || "$deps" == " " ]]; then
        return 0
    fi
    
    for dep in $deps; do
        dep=$(echo "$dep" | tr -d ' ')
        if [[ -n "$dep" ]] && ! is_completed "$dep"; then
            return 1
        fi
    done
    return 0
}

# Get the next ready task
get_next_task() {
    for task_id in $(get_all_tasks); do
        if ! is_completed "$task_id" && dependencies_satisfied "$task_id"; then
            echo "$task_id"
            return 0
        fi
    done
    return 1
}

# Get task details
get_task_details() {
    local task_id="$1"
    awk "/^### $task_id:/{found=1} found{print} found && /^\*\*Depends on:\*\*/{exit}" "$TASKS_FILE"
}

# Get task title
get_task_title() {
    local task_id="$1"
    grep "^### $task_id:" "$TASKS_FILE" | sed "s/^### $task_id: //"
}

# Mark task as completed
mark_completed() {
    local task_id="$1"
    echo "$task_id" >> "$COMPLETED_FILE"
    
    # Update progress file
    local timestamp=$(date "+%Y-%m-%d %H:%M")
    local title=$(get_task_title "$task_id")
    echo "" >> "$PROGRESS_FILE"
    echo "## $timestamp - $task_id: $title" >> "$PROGRESS_FILE"
    echo "- Completed by Ralph" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
}

# Run opencode with timeout monitoring
# Returns: 0=success, 1=regular failure, 2=timeout
# Sets global LAST_OUTPUT on timeout
run_opencode_with_timeout() {
    local prompt="$1"
    local task_id="$2"
    local output_file
    output_file=$(mktemp)
    local last_size=0
    local seconds_without_output=0
    local timeout_seconds=$TIMEOUT_SECONDS
    local display_threshold=5  # Show counter after this many seconds
    local counter_visible=false
    local subshell_pid=""
    
    # Trap to clean up on Ctrl+C
    cleanup() {
        if [[ -n "$subshell_pid" ]]; then
            pkill -TERM -P "$subshell_pid" 2>/dev/null
            kill "$subshell_pid" 2>/dev/null
            wait "$subshell_pid" 2>/dev/null
        fi
        rm -f "$output_file"
        exit 130
    }
    trap cleanup INT TERM
    
    # Start opencode in a subshell
    (
        opencode run -m github-copilot/claude-opus-4.5 --title "Ralph: $task_id" "$prompt" 2>&1 | tee "$output_file"
    ) &
    subshell_pid=$!
    
    # Monitor loop
    while kill -0 "$subshell_pid" 2>/dev/null; do
        sleep 1
        local current_size
        current_size=$(stat -f%z "$output_file" 2>/dev/null || echo "0")
        
        if [[ "$current_size" -gt "$last_size" ]]; then
            # New output detected, reset timer
            last_size=$current_size
            seconds_without_output=0
            counter_visible=false
        else
            seconds_without_output=$((seconds_without_output + 1))
            
            # Show counter if past threshold (print in place, carriage return to reset)
            if [[ $seconds_without_output -ge $display_threshold ]]; then
                printf "\r${YELLOW}[IDLE: %02ds]${NC}" "$seconds_without_output" >&2
                counter_visible=true
            fi
            
            if [[ $seconds_without_output -ge $timeout_seconds ]]; then
                # Timeout! Clear counter and kill the process tree
                if [[ "$counter_visible" == true ]]; then
                    printf "\r           \r" >&2
                fi
                echo -e "${RED}⚠️ TIMEOUT: No output for ${timeout_seconds} seconds. Killing process...${NC}"
                
                # Kill children of the subshell, then the subshell
                pkill -TERM -P "$subshell_pid" 2>/dev/null
                kill "$subshell_pid" 2>/dev/null
                sleep 1
                # Force kill if still alive
                pkill -9 -P "$subshell_pid" 2>/dev/null
                kill -9 "$subshell_pid" 2>/dev/null
                wait "$subshell_pid" 2>/dev/null
                
                # Capture last 20 lines
                LAST_OUTPUT=$(tail -20 "$output_file")
                rm -f "$output_file"
                trap - INT TERM  # Reset trap
                return 2  # Special exit code for timeout
            fi
        fi
    done
    
    # Process finished normally - clear any lingering counter
    if [[ "$counter_visible" == true ]]; then
        printf "\r           \r" >&2
    fi
    
    wait "$subshell_pid"
    local exit_code=$?
    rm -f "$output_file"
    trap - INT TERM  # Reset trap
    return $exit_code
}

# Show status
show_status() {
    local total=$(get_all_tasks | wc -l | tr -d ' ')
    local completed=$(wc -l < "$COMPLETED_FILE" 2>/dev/null | tr -d ' ')
    local remaining=$((total - completed))
    local percent=$((completed * 100 / total))
    
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}               ${YELLOW}WINTERMUTE RALPH STATUS${NC}                      ${CYAN}║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║${NC}  Total Tasks:     ${total}                                       ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  Completed:       ${GREEN}${completed}${NC}                                        ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  Remaining:       ${YELLOW}${remaining}${NC}                                       ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  Progress:        ${percent}%                                       ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    
    # Show progress bar
    local bar_width=50
    local filled=$((percent * bar_width / 100))
    local empty=$((bar_width - filled))
    echo -n "  ["
    printf "${GREEN}%${filled}s${NC}" | tr ' ' '█'
    printf "%${empty}s" | tr ' ' '░'
    echo "]"
    echo ""
    
    # Show next ready tasks
    echo -e "${CYAN}Next ready tasks:${NC}"
    local count=0
    for task_id in $(get_all_tasks); do
        if ! is_completed "$task_id" && dependencies_satisfied "$task_id"; then
            local title=$(get_task_title "$task_id")
            echo -e "  ${GREEN}→${NC} $task_id: $title"
            count=$((count + 1))
            if [[ $count -ge 5 ]]; then
                echo "  ..."
                break
            fi
        fi
    done
    
    if [[ $count -eq 0 ]]; then
        if [[ $remaining -eq 0 ]]; then
            echo -e "  ${GREEN}✓ All tasks completed!${NC}"
        else
            echo -e "  ${RED}No tasks ready (check dependencies)${NC}"
        fi
    fi
}

# Show next task details
show_next() {
    local next_task=$(get_next_task)
    if [[ -z "$next_task" ]]; then
        echo -e "${GREEN}✓ All tasks completed or no tasks ready!${NC}"
        return 0
    fi
    
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}                  ${YELLOW}NEXT TASK${NC}                                 ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    get_task_details "$next_task"
    echo ""
}

# Execute one task with opencode
execute_task() {
    local task_id="$1"
    local title=$(get_task_title "$task_id")
    local details=$(get_task_details "$task_id")
    
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Executing: $task_id - $title${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Create the prompt for opencode
    local prompt="Execute Ralph task $task_id: $title

## Task Details
$details

## Instructions
1. Read scripts/ralph/progress.txt for context from previous iterations
2. Implement the task following the description above
3. Ensure all acceptance criteria are met
4. Run 'pnpm typecheck' or 'go build' as appropriate to verify
5. After completing the work, commit your changes with message: 'feat($task_id): $title'

When complete, respond with 'TASK COMPLETE' so the script knows to continue.

IMPORTANT: Focus only on this specific task. Do not work on other tasks."

    # Run opencode with the prompt
    echo "$prompt" | opencode
    
    # Ask for confirmation
    echo ""
    echo -e "${YELLOW}Was this task completed successfully? (y/n)${NC}"
    read -r response
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        mark_completed "$task_id"
        echo -e "${GREEN}✓ Task $task_id marked as completed${NC}"
        return 0
    else
        echo -e "${RED}✗ Task not marked as completed. Fix issues and try again.${NC}"
        return 1
    fi
}

# Run one iteration
run_once() {
    local next_task=$(get_next_task)
    if [[ -z "$next_task" ]]; then
        echo -e "${GREEN}✓ All tasks completed!${NC}"
        return 1
    fi
    
    execute_task "$next_task"
}

# Run loop until done or interrupted
run_loop() {
    echo -e "${CYAN}Starting Ralph loop. Press Ctrl+C to stop.${NC}"
    echo ""
    
    while true; do
        local next_task=$(get_next_task)
        if [[ -z "$next_task" ]]; then
            echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
            echo -e "${GREEN}   ✓ ALL TASKS COMPLETED! Wintermute is ready.          ${NC}"
            echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
            break
        fi
        
        if ! execute_task "$next_task"; then
            echo -e "${YELLOW}Pausing loop due to task failure. Fix and re-run.${NC}"
            break
        fi
        
        echo ""
        echo -e "${CYAN}Continuing to next task in 3 seconds...${NC}"
        sleep 3
    done
}

# Auto mode - runs with opencode in non-interactive mode
run_auto() {
    echo -e "${CYAN}Starting Ralph in AUTO mode...${NC}"
    echo ""
    
    local next_task=$(get_next_task)
    if [[ -z "$next_task" ]]; then
        echo -e "${GREEN}✓ All tasks completed!${NC}"
        return 1  # Return 1 to stop the loop
    fi
    
    local title=$(get_task_title "$next_task")
    local details=$(get_task_details "$next_task")
    
    echo -e "${YELLOW}Executing: $next_task - $title${NC}"
    
    local consecutive_timeouts=0
    LAST_OUTPUT=""
    
    while true; do
        # Build timeout context if we've had timeouts
        local timeout_context=""
        if [[ $consecutive_timeouts -gt 0 ]]; then
            timeout_context="

## ⚠️ TIMEOUT WARNING
The previous agent session timed out after $TIMEOUT_SECONDS seconds of no output. This has happened $consecutive_timeouts time(s) in a row.

Look at what happened and try to break up your tool calls, or whatever you were doing during the last iteration, into multiple steps to avoid the timeout.

These are the last 20 lines of its output:
\`\`\`
$LAST_OUTPUT
\`\`\`

"
            if [[ $consecutive_timeouts -ge 5 ]]; then
                timeout_context="$timeout_context
## 🚨🚨🚨 THIS HAS HAPPENED TOO MANY TIMES!!! TRY SOMETHING FUCKING DIFFERENT!!! 🚨🚨🚨
"
            fi
        fi
        
        # Build the prompt
        local prompt="You are Ralph, an autonomous task executor for the Wintermute project.
$timeout_context
## Current Task: $next_task
$details

## Your Mission
1. First, read scripts/ralph/progress.txt to understand what has been done before
2. Implement this specific task completely
3. Verify your work compiles/typechecks
4. Commit with message: \"feat($next_task): $title\"
5. Update scripts/ralph/progress.txt with what you did

## Quality Checklist
- [ ] Code compiles without errors
- [ ] pnpm typecheck passes (for TS) or go build passes (for Go)  
- [ ] Changes are committed
- [ ] Progress file is updated

## Important Notes
- Focus ONLY on this task
- Read existing code to understand patterns
- Follow the project's code style (see AGENTS.md)
- If blocked, document why in progress.txt

Begin implementation now."

        # Run opencode with timeout monitoring
        run_opencode_with_timeout "$prompt" "$next_task"
        local exit_code=$?
        
        if [[ $exit_code -eq 0 ]]; then
            # Success!
            mark_completed "$next_task"
            echo -e "${GREEN}✓ Task $next_task completed${NC}"
            
            # Show status after completion
            echo ""
            show_status
            return 0
        elif [[ $exit_code -eq 2 ]]; then
            # Timeout - retry
            consecutive_timeouts=$((consecutive_timeouts + 1))
            echo -e "${YELLOW}⚠️ Timeout #${consecutive_timeouts}. Retrying with context...${NC}"
            sleep 2
            continue
        else
            # Regular failure
            echo -e "${RED}✗ Task execution failed (exit code: $exit_code)${NC}"
            return 1
        fi
    done
}

# Main entry point
main() {
    cd "$PROJECT_ROOT"
    
    case "${1:-}" in
        --status|-s)
            show_status
            ;;
        --next|-n)
            show_next
            ;;
        --loop|-l)
            run_loop
            ;;
        --auto|-a)
            while run_auto; do sleep 5; done;
            ;;
        --help|-h)
            echo "Wintermute Ralph - Autonomous Task Executor"
            echo ""
            echo "Usage: ./ralph.sh [option]"
            echo ""
            echo "Options:"
            echo "  (none)      Run one task interactively"
            echo "  --status    Show current progress"
            echo "  --next      Show next ready task"
            echo "  --loop      Run tasks in a loop (interactive)"
            echo "  --auto      Run tasks in a loop (non-interactive, streams output)"
            echo "  --help      Show this help"
            ;;
        *)
            run_once
            ;;
    esac
}

main "$@"
