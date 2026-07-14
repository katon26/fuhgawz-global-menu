#!/usr/bin/env bash
# patch-launcher.sh — Force XWayland for a specific desktop application to enable global menu

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
die()     { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }

if [ "$#" -lt 1 ]; then
    die "Usage: $0 <app-name-or-desktop-file>\nExample: $0 firefox\nExample: $0 org.mozilla.firefox.desktop"
fi

APP_INPUT="$1"
DESKTOP_FILE=""

# Search paths for desktop files
SEARCH_PATHS=(
    "${HOME}/.local/share/applications"
    "/usr/share/applications"
    "/var/lib/flatpak/exports/share/applications"
    "${HOME}/.local/share/flatpak/exports/share/applications"
)

# 1. Locate the desktop file
if [[ "${APP_INPUT}" == *.desktop ]]; then
    for path in "${SEARCH_PATHS[@]}"; do
        if [[ -f "${path}/${APP_INPUT}" ]]; then
            DESKTOP_FILE="${path}/${APP_INPUT}"
            break
        fi
    done
else
    # Search for match containing the app name
    for path in "${SEARCH_PATHS[@]}"; do
        if [[ -d "${path}" ]]; then
            # Find closest match
            match=$(find "${path}" -name "*${APP_INPUT}*.desktop" | head -n 1)
            if [[ -n "${match}" ]]; then
                DESKTOP_FILE="${match}"
                break
            fi
        fi
    done
fi

if [[ -z "${DESKTOP_FILE}" ]]; then
    die "Could not locate a desktop file for '${APP_INPUT}'."
fi

FILE_NAME=$(basename "${DESKTOP_FILE}")
USER_APP_DIR="${HOME}/.local/share/applications"
USER_DESKTOP_FILE="${USER_APP_DIR}/${FILE_NAME}"

info "Found desktop file at: ${DESKTOP_FILE}"
info "Creating local override at: ${USER_DESKTOP_FILE}"

mkdir -p "${USER_APP_DIR}"
if [[ "${DESKTOP_FILE}" != "${USER_DESKTOP_FILE}" ]]; then
    cp -f "${DESKTOP_FILE}" "${USER_DESKTOP_FILE}"
fi

# 2. Modify Exec lines to prepend GDK_BACKEND=x11 (and MOZ_ENABLE_WAYLAND=0 for Firefox)
# First, clean up any existing GDK_BACKEND or MOZ_ENABLE_WAYLAND variables to avoid duplication
sed -i 's/GDK_BACKEND=[a-zA-Z0-9-]* //g' "${USER_DESKTOP_FILE}"
sed -i 's/MOZ_ENABLE_WAYLAND=[01] //g' "${USER_DESKTOP_FILE}"
sed -i 's/^Exec=\(env \)\?/Exec=env /g' "${USER_DESKTOP_FILE}"

if [[ "${FILE_NAME}" == *firefox* ]]; then
    sed -i 's/^Exec=env /Exec=env GDK_BACKEND=x11 MOZ_ENABLE_WAYLAND=0 /g' "${USER_DESKTOP_FILE}"
else
    sed -i 's/^Exec=env /Exec=env GDK_BACKEND=x11 /g' "${USER_DESKTOP_FILE}"
fi

# 3. Notify desktop database
if command -v update-desktop-database &>/dev/null; then
    update-desktop-database "${USER_APP_DIR}"
fi

success "Successfully patched '${FILE_NAME}'! Next time you launch it from your desktop panel or dock, it will run under XWayland and export its menu."
