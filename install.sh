#!/usr/bin/env bash
# install.sh — Installer for FUHGAWZ Global Menu GNOME Extension

set -euo pipefail

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

UUID="fuhgawzglbmenu@katon26.github.io"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

info "Installing FUHGAWZ Global Menu to ${EXT_DIR}..."
mkdir -p "${EXT_DIR}"
cp -f metadata.json extension.js prefs.js stylesheet.css "${EXT_DIR}/"
for dir in src app icons sysmenu; do
    if [[ -d "${dir}" ]]; then
        mkdir -p "${EXT_DIR}/${dir}"
        cp -rf "${dir}"/* "${EXT_DIR}/${dir}/"
    fi
done
if [[ -d schemas ]]; then
    mkdir -p "${EXT_DIR}/schemas"
    cp -f schemas/* "${EXT_DIR}/schemas/"
    glib-compile-schemas "${EXT_DIR}/schemas"
fi
success "Extension files, preferences, modules, icons, and compiled schemas copied."

# Configure GTK 3 settings.ini to load appmenu-gtk-module
GTK3_CONF_DIR="${HOME}/.config/gtk-3.0"
GTK3_CONF_FILE="${GTK3_CONF_DIR}/settings.ini"
MODULE_LINE="gtk-modules=appmenu-gtk-module"

info "Configuring GTK 3 to export menus..."
mkdir -p "${GTK3_CONF_DIR}"
if [[ ! -f "${GTK3_CONF_FILE}" ]]; then
    printf '[Settings]\n%s\n' "${MODULE_LINE}" > "${GTK3_CONF_FILE}"
    success "Created ${GTK3_CONF_FILE} with appmenu-gtk-module."
else
    if grep -q "gtk-modules" "${GTK3_CONF_FILE}"; then
        if grep -q "appmenu-gtk-module" "${GTK3_CONF_FILE}"; then
            success "appmenu-gtk-module already present in ${GTK3_CONF_FILE}."
        else
            sed -i 's/^\(gtk-modules=.*\)$/\1:appmenu-gtk-module/' "${GTK3_CONF_FILE}"
            success "Appended appmenu-gtk-module to existing gtk-modules entry in ${GTK3_CONF_FILE}."
        fi
    else
        if grep -q '^\[Settings\]' "${GTK3_CONF_FILE}"; then
            sed -i '/^\[Settings\]/a '"${MODULE_LINE}" "${GTK3_CONF_FILE}"
        else
            printf '\n[Settings]\n%s\n' "${MODULE_LINE}" >> "${GTK3_CONF_FILE}"
        fi
        success "Added ${MODULE_LINE} to ${GTK3_CONF_FILE}."
    fi
fi

# Configure GTK 2 .gtkrc-2.0
GTK2_CONF="${HOME}/.gtkrc-2.0"
GTK2_LINE='gtk-modules="appmenu-gtk-module"'
if [[ ! -f "${GTK2_CONF}" ]] || ! grep -q "appmenu-gtk-module" "${GTK2_CONF}"; then
    echo "${GTK2_LINE}" >> "${GTK2_CONF}"
    success "Added appmenu-gtk-module to ${GTK2_CONF}."
else
    success "appmenu-gtk-module already present in ${GTK2_CONF}."
fi

# Inform about system packages
info "Checking system packages..."
if ! rpm -q appmenu-gtk3-module &>/dev/null; then
    warn "The 'appmenu-gtk3-module' package is not installed."
    warn "For GTK applications to export their menus, please install it using:"
    warn "    ${BOLD}sudo dnf install appmenu-gtk3-module${RESET}"
else
    success "appmenu-gtk3-module is installed."
fi

echo
echo -e "${BOLD}${GREEN}Installation Complete!${RESET}"
echo -e "To apply the changes:"
echo -e "  ${CYAN}1.${RESET} Log out and log back in (so GNOME Shell and apps reload the new module/extension)."
echo -e "  ${CYAN}2.${RESET} Enable the extension using Extension Manager or command line:"
echo -e "       ${BOLD}gnome-extensions enable ${UUID}${RESET}"
echo
