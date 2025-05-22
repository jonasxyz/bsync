#!/bin/bash

# Module 3: Install Mamba

# Exit the script if any command fails
set -e

echo "Module 3: Starting Mamba installation..."

cd "/home/$USER/Downloads"

echo "Downloading Mambaforge..."
# The URL uses $(uname) and $(uname -m) to get the correct version for the system architecture and OS.
curl -L -O "https://github.com/conda-forge/miniforge/releases/latest/download/Mambaforge-$(uname)-$(uname -m).sh"

echo "Installing Mambaforge..."
# Installation is done in batch mode (-b) and accepts licenses (-p specifies the path)
# The path is /home/$USER/mambaforge to avoid conflicts with existing Conda installations
# and ensure a clean installation.
bash Mambaforge-$(uname)-$(uname -m).sh -b -p "/home/$USER/mambaforge"

echo "Initializing Mambaforge shell hooks and configuring Conda..."
# Ensures that 'conda' and 'mamba' commands are available in new shells.
# conda shell.bash hook initializes the necessary environment variables.
# auto_activate_base true ensures that the 'base' environment is activated by default.
# conda init writes the initialization to the shell configuration files (e.g., .bashrc).

SHELL_CONFIG_FILE=""
if [ -n "$BASH_VERSION" ]; then
    SHELL_CONFIG_FILE="$HOME/.bashrc"
elif [ -n "$ZSH_VERSION" ]; then
    SHELL_CONFIG_FILE="$HOME/.zshrc"
else
    echo "Unknown shell. Mamba initialization may need to be added manually to your shell configuration file."
    # As a fallback, we try .bashrc
    SHELL_CONFIG_FILE="$HOME/.bashrc"
fi

# Only run conda init if the file exists to avoid errors
if [ -f "$SHELL_CONFIG_FILE" ]; then
    eval "$(/home/$USER/mambaforge/bin/conda shell.bash hook)"
    /home/$USER/mambaforge/bin/conda config --set auto_activate_base true
    /home/$USER/mambaforge/bin/conda init bash
    echo "Mamba initialization added to $SHELL_CONFIG_FILE."
    echo "Please restart your shell or run 'source $SHELL_CONFIG_FILE' to apply the changes."
else
    echo "Shell configuration file ($SHELL_CONFIG_FILE) not found. Skipping conda init."
    echo "You may need to manually add Mambaforge to your PATH and run 'conda init <your-shell>'."
fi

echo "Cleaning up downloaded Mambaforge installer..."
rm Mambaforge-$(uname)-$(uname -m).sh

echo "Module 3: Mamba installation complete."
echo "IMPORTANT: You need to restart your shell or run 'source ~/.bashrc' (or your shell configuration file) for the changes to take effect and for Mamba/Conda to work correctly." 