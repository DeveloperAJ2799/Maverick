#compdef mavrick mavrick-backup mavrick-calendar mavrick-contacts mavrick-cookbook mavrick-docs mavrick-gallery mavrick-mail mavrick-mcp mavrick-memory mavrick-notes mavrick-personal mavrick-preset mavrick-research mavrick-sessions mavrick-signature mavrick-skills mavrick-tasks mavrick-theme mavrick-webhook
# Zsh tab-completion for the mavrick umbrella + sub-CLIs.
#
# Drop in any directory on $fpath, e.g.:
#     fpath=(/path/to/mavrick-ui/scripts/_completion $fpath)
#     autoload -U compinit; compinit
#
# Then `mavrick <tab>` completes subcommands; `mavrick mail <tab>`
# completes mail subcommands; `mavrick-mail <tab>` works the same.

_mavrick_scripts_dir() {
    local self="${(%):-%x}"
    while [[ -L "$self" ]]; do self="$(readlink "$self")"; done
    cd "${self:h}/.." && pwd
}

typeset -gA _mavrick_subs

_mavrick_refresh() {
    _mavrick_subs=()
    local dir="$(_mavrick_scripts_dir)"
    local py="$dir/../venv/bin/python"
    [[ -x "$py" ]] || py="$(command -v python3)"
    local f sub help_out commands
    for f in "$dir"/mavrick-*; do
        [[ -x "$f" ]] || continue
        case "$f" in
            *.bak|*.pyc|*.pre-*) continue ;;
        esac
        sub="${${f:t}#mavrick-}"
        help_out=$("$py" "$f" --help 2>/dev/null) || continue
        commands=$(echo "$help_out" | grep -oE '\{[a-z0-9_,-]+\}' | head -1 \
            | tr -d '{}' | tr ',' ' ')
        _mavrick_subs[$sub]="$commands"
    done
}

_mavrick() {
    [[ ${#_mavrick_subs} -eq 0 ]] && _mavrick_refresh

    local cmd="${words[1]}"

    if [[ "$cmd" == "mavrick" ]]; then
        if (( CURRENT == 2 )); then
            local -a subs=(${(k)_mavrick_subs} help)
            _describe 'subcommand' subs
            return
        fi
        local sub="${words[2]}"
        if [[ "$sub" == "help" ]] && (( CURRENT == 3 )); then
            local -a subs=(${(k)_mavrick_subs})
            _describe 'subcommand' subs
            return
        fi
        if (( CURRENT == 3 )); then
            local -a sc=(${(s/ /)_mavrick_subs[$sub]})
            _describe 'command' sc
            return
        fi
        return
    fi

    # mavrick-foo <tab>
    local sub="${cmd#mavrick-}"
    if (( CURRENT == 2 )); then
        local -a sc=(${(s/ /)_mavrick_subs[$sub]})
        _describe 'command' sc
        return
    fi
}

_mavrick "$@"
