#!/usr/bin/env bash
# setup.sh: set up the second brain on this PC. Safe to run again.
#
#   ./setup.sh [--non-interactive] [--no-qmd] [--no-install]
#
#   --non-interactive  read the Gemini key from stdin instead of prompting
#   --no-qmd           skip QMD semantic search (search falls back to grep)
#   --no-install       install nothing (no uv, graphify or qmd downloads)
#
# It targets WSL2 on Windows. It writes the Gemini key only to
# ~/.config/second-brain/.env (mode 600), never into this repo, and it never
# prints it.
set -euo pipefail

VAULT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
NON_INTERACTIVE=0
NO_QMD=0
NO_INSTALL=0

usage() {
	cat >&2 <<'USAGE'
usage: ./setup.sh [--non-interactive] [--no-qmd] [--no-install]
USAGE
}

for arg in "$@"; do
	case "$arg" in
		--non-interactive) NON_INTERACTIVE=1 ;;
		--no-qmd) NO_QMD=1 ;;
		--no-install) NO_INSTALL=1 ;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "setup: unknown option: $arg" >&2
			usage
			exit 2
			;;
	esac
done

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
	printf 'setup: %s\n' "$*" >&2
	exit 1
}

# Always against this vault, whatever BRAIN_VAULT the shell already holds.
brain() {
	BRAIN_VAULT="$VAULT" node --disable-warning=ExperimentalWarning --experimental-strip-types \
		"$VAULT/.claude/scripts/brain.ts" "$@"
}

# --- 1. Checks ---------------------------------------------------------------

proc_version="${BRAIN_PROC_VERSION:-/proc/version}"
if ! grep -qi microsoft "$proc_version" 2>/dev/null; then
	die "this setup targets WSL2 on Windows, and this does not look like WSL. Native Linux, macOS and Windows are not supported yet."
fi
command -v node >/dev/null 2>&1 || die "Node 22 or newer is required, and node was not found."
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || ((node_major < 22)); then
	die "Node 22 or newer is required (found ${node_major})."
fi
command -v git >/dev/null 2>&1 || die "git is required."
case "$VAULT" in
	*"'"*) die "the vault path contains a single quote, which the env file cannot hold: $VAULT" ;;
esac
chmod +x "$VAULT"/bin/* 2>/dev/null || true

# --- 2. The Gemini key -------------------------------------------------------

env_dir="$HOME/.config/second-brain"
env_file="$env_dir/.env"

key=""
if [[ $NON_INTERACTIVE -eq 1 ]]; then
	IFS= read -r key || true
elif [[ -t 0 ]]; then
	printf 'Gemini API key (Enter to skip, or to keep the one already stored): ' >&2
	IFS= read -rs key || true
	printf '\n' >&2
fi
key="${key//$'\r'/}"
key="${key#"${key%%[![:space:]]*}"}"
key="${key%"${key##*[![:space:]]}"}"
if [[ -n "$key" && ! "$key" =~ ^[A-Za-z0-9._-]+$ ]]; then
	die "that does not look like a Gemini API key (letters, digits, dot, dash and underscore only). Nothing was written."
fi
if [[ -z "$key" && -f "$env_file" ]]; then
	key="$(sed -n "s/^GEMINI_API_KEY='\{0,1\}\([A-Za-z0-9._-]*\)'\{0,1\}\$/\1/p" "$env_file" | tail -n 1)"
fi

# --- 3. Install the tools ----------------------------------------------------

if [[ $NO_INSTALL -eq 0 ]]; then
	if command -v uv >/dev/null 2>&1; then
		uv tool install 'graphifyy[gemini]' || warn "could not install graphify with uv"
		if command -v graphify >/dev/null 2>&1; then
			graphify install || warn "graphify install did not finish"
		else
			warn "graphify is not on PATH yet; open a new shell and run: graphify install"
		fi
	else
		warn "uv is not installed, so graphify was skipped. Install uv (https://docs.astral.sh/uv/) and run this again."
	fi
fi

# --- 4. QMD ------------------------------------------------------------------

qmd_on=false
if [[ $NO_QMD -eq 0 ]]; then
	if ! command -v qmd >/dev/null 2>&1 && [[ $NO_INSTALL -eq 0 ]]; then
		if command -v npm >/dev/null 2>&1; then
			npm install -g @tobilu/qmd || warn "could not install qmd"
		else
			warn "npm was not found, so qmd was not installed"
		fi
	fi
	if (cd "$VAULT" && node --experimental-strip-types .scripts/qmd-bootstrap.ts); then
		qmd_on=true
	else
		warn "qmd could not be set up, so semantic search is off and search falls back to grep. Fix it, then run this again."
	fi
fi
brain setup-merge config --qmd "$qmd_on"

# --- 5. The env file: vault, key, PATH ---------------------------------------

mkdir -p "$env_dir"
chmod 700 "$env_dir"
umask 077
tmp="$(mktemp "$env_dir/.env.XXXXXX")"
{
	printf "BRAIN_VAULT='%s'\n" "$VAULT"
	if [[ -n "$key" ]]; then printf "GEMINI_API_KEY='%s'\n" "$key"; fi
	# Put bin/ on PATH once, however many shells source this.
	printf 'case ":$PATH:" in *":%s/bin:"*) ;; *) PATH="%s/bin:$PATH" ;; esac\n' "$VAULT" "$VAULT"
} >"$tmp"
chmod 600 "$tmp"
mv "$tmp" "$env_file"
say "wrote $env_file (mode 600)"
if [[ -z "$key" ]]; then
	warn "no Gemini key stored: every save will fall back to a Claude subagent until you add GEMINI_API_KEY to $env_file"
fi

rc_line='[ -f "$HOME/.config/second-brain/.env" ] && { set -a; . "$HOME/.config/second-brain/.env"; set +a; } # second-brain'
for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
	touch "$rc"
	if ! grep -qF '# second-brain' "$rc"; then
		printf '\n%s\n' "$rc_line" >>"$rc"
		say "added the second-brain line to $rc"
	fi
done

# --- 6. Claude Code: hooks, MCP server, global CLAUDE.md ----------------------

mkdir -p "$HOME/.claude"
brain setup-merge settings --file "$HOME/.claude/settings.json" || die "could not add the brain hooks to settings.json"
brain setup-merge claude-md --file "$HOME/.claude/CLAUDE.md" || die "could not write the second-brain section of CLAUDE.md"

mcp_cmd=(claude mcp add --scope user om -- node "$VAULT/.claude/scripts/om-mcp.mjs")
if command -v claude >/dev/null 2>&1; then
	if "${mcp_cmd[@]}" >/dev/null 2>&1; then
		say "registered the om MCP server (user scope)"
	else
		# It exists already, perhaps from another vault path: register it afresh.
		claude mcp remove --scope user om >/dev/null 2>&1 || true
		if "${mcp_cmd[@]}" >/dev/null 2>&1; then
			say "re-registered the om MCP server (user scope)"
		else
			warn "could not register the om MCP server. Run: ${mcp_cmd[*]}"
		fi
	fi
else
	warn "the claude CLI was not found. Once it is installed, run: ${mcp_cmd[*]}"
fi

# --- 7. The secret guard -----------------------------------------------------

if [[ -d "$VAULT/.git" ]]; then
	hook="$VAULT/.git/hooks/pre-commit"
	mkdir -p "$VAULT/.git/hooks"
	if [[ -e "$hook" && ! -L "$hook" ]]; then
		warn "a pre-commit hook is already in $hook, so the secret guard was not installed. Call $VAULT/bin/brain-precommit from it."
	else
		ln -sfn "$VAULT/bin/brain-precommit" "$hook"
		say "installed the secret guard as the vault's pre-commit hook"
	fi
else
	warn "$VAULT is not a git repository, so the secret guard was not installed"
fi

# --- 8. What to do by hand ---------------------------------------------------

distro="${WSL_DISTRO_NAME:-<your distro>}"
win_path="\\\\wsl.localhost\\${distro}${VAULT//\//\\}"
cat <<MSG

Setup done. By hand:

  1. Install Obsidian for Windows (https://obsidian.md), then open this folder as a vault:
       ${win_path}
  2. Open a new shell so PATH and the env file load, then link each code repo:
       cd <repo> && brain link
  3. In Obsidian turn on Settings, General, Command line interface (needs Obsidian 1.12 or newer).

QMD loads local search models (about 2.3 GB). If WSL runs out of memory, raise
memory= under [wsl2] in %UserProfile%\\.wslconfig (for example memory=8GB) and
run 'wsl --shutdown' from Windows, or turn it off with "qmdEnabled": false in
brain.config.json.
MSG
