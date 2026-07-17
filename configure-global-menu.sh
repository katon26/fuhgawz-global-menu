#!/usr/bin/env bash
# configure-global-menu.sh — Builder and Configurator for Aero Global Menu on Fedora

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
die()     { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }

# ── Step 1: Install Build Dependencies ─────────────────────────────────────────
info "Installing build dependencies via dnf (requires sudo)..."
sudo dnf install -y gcc gcc-c++ meson ninja-build gtk3-devel glib2-devel appmenu-qt5

success "Build dependencies installed successfully."

# ── Step 2: Build appmenu-gtk-module ──────────────────────────────────────────
VALA_DIR="/home/kaf/Projects/vala-panel-appmenu"
GTK_MODULE_DIR="${VALA_DIR}/subprojects/appmenu-gtk-module"

if [[ ! -d "${GTK_MODULE_DIR}" ]]; then
    die "Could not find appmenu-gtk-module source at ${GTK_MODULE_DIR}. Please make sure vala-panel-appmenu is cloned."
fi

info "Configuring build for appmenu-gtk-module..."
cd "${GTK_MODULE_DIR}"

# Clean existing build directory if present
rm -rf builddir

# Setup build with Meson (compiling only GTK 3 module)
meson setup builddir -Dgtk=3 --prefix=/usr

info "Compiling appmenu-gtk-module..."
meson compile -C builddir

info "Installing appmenu-gtk-module to system (requires sudo)..."
sudo meson install -C builddir

# Force reload system linker cache
sudo ldconfig

# Compile GSettings schemas so applications do not crash when loading the module
info "Compiling system GSettings schemas..."
sudo glib-compile-schemas /usr/share/glib-2.0/schemas/

success "appmenu-gtk-module built, installed, and schemas compiled successfully."

# ── Step 3: Configure User Environment ─────────────────────────────────────────
info "Configuring user GTK and environment files..."

GTK3_CONF_DIR="${HOME}/.config/gtk-3.0"
GTK3_CONF_FILE="${GTK3_CONF_DIR}/settings.ini"
MODULE_LINE="gtk-modules=appmenu-gtk-module"

mkdir -p "${GTK3_CONF_DIR}"

if [[ ! -f "${GTK3_CONF_FILE}" ]]; then
    printf '[Settings]\n%s\n' "${MODULE_LINE}" > "${GTK3_CONF_FILE}"
    success "Created ${GTK3_CONF_FILE}."
else
    if grep -q "gtk-modules" "${GTK3_CONF_FILE}"; then
        if grep -q "appmenu-gtk-module" "${GTK3_CONF_FILE}"; then
            success "appmenu-gtk-module already registered in ${GTK3_CONF_FILE}."
        else
            sed -i 's/^\(gtk-modules=.*\)$/\1:appmenu-gtk-module/' "${GTK3_CONF_FILE}"
            success "Appended appmenu-gtk-module to gtk-modules in ${GTK3_CONF_FILE}."
        fi
    else
        if grep -q '^\[Settings\]' "${GTK3_CONF_FILE}"; then
            sed -i '/^\[Settings\]/a '"${MODULE_LINE}" "${GTK3_CONF_FILE}"
        else
            printf '\n[Settings]\n%s\n' "${MODULE_LINE}" >> "${GTK3_CONF_FILE}"
        fi
        success "Added gtk-modules setting to ${GTK3_CONF_FILE}."
    fi
fi

# Configure GTK 2
GTK2_CONF="${HOME}/.gtkrc-2.0"
GTK2_LINE='gtk-modules="appmenu-gtk-module"'
if [[ ! -f "${GTK2_CONF}" ]] || ! grep -q "appmenu-gtk-module" "${GTK2_CONF}"; then
    echo "${GTK2_LINE}" >> "${GTK2_CONF}"
    success "Added appmenu-gtk-module to ${GTK2_CONF}."
else
    success "appmenu-gtk-module already registered in ${GTK2_CONF}."
fi

# Set session environment variables via systemd environment.d
ENV_DIR="${HOME}/.config/environment.d"
ENV_FILE="${ENV_DIR}/10-global-menu.conf"
mkdir -p "${ENV_DIR}"
info "Writing systemd environment configuration to ${ENV_FILE}..."
cat << 'EOF' > "${ENV_FILE}"
GTK_MODULES=appmenu-gtk-module
UBUNTU_MENUPROXY=1
EOF
success "Systemd session environment variables registered."

# ── Step 4: Configure Flatpak Overrides ───────────────────────────────────────
if command -v flatpak &>/dev/null; then
    info "Configuring Flatpak overrides to allow sandboxed apps to talk to global menu..."
    flatpak override --user --talk-name=com.canonical.AppMenu.Registrar || warn "Failed to set Flatpak overrides."
    flatpak override --user --env=GTK_MODULES=appmenu-gtk-module --env=UBUNTU_MENUPROXY=1 || warn "Failed to set Flatpak environment variables."
    success "Flatpak overrides configured."
else
    info "Flatpak not installed. Skipping overrides."
fi

# ── Conclusion ────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}${GREEN}Configuration and Installation Complete!${RESET}"
echo -e "To make the application menus active in the panel:"
echo -e "  ${CYAN}1.${RESET} Log out of your current session and log back in."
echo -e "  ${CYAN}2.${RESET} Make sure the extension is enabled: ${BOLD}gnome-extensions enable fuhgawzglbmenu@katon26.github.io${RESET}"
echo -e "  ${CYAN}3.${RESET} Start any GTK 3 app (e.g. Firefox) or Qt app and enjoy the global menu!"
echo
