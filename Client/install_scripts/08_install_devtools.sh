#!/bin/bash

# Module 08: Install optional development tools

# Exit the script if any command fails
set -e

echo "Module 08: Starting installation of optional development tools..."

# Default to not installing unless an argument is passed
INSTALL_DEVTOOLS=false

REMOTE_NFS_MOUNT_POINT="10.10.10.1:/data/nfs/bsync-Data"
LOCAL_NFS_MOUNT_POINT="/nfs/bsync-Data"

# Check if an argument like --install-devtools was passed
for arg in "$@"
do
  if [[ "$arg" == "--install-devtools" ]]; then
    INSTALL_DEVTOOLS=true
    break
  fi
done

if [ "$INSTALL_DEVTOOLS" = true ] ; then
    echo "Installing openssh-server and tmux..."
    sudo apt-get update -y
    sudo apt-get install -y openssh-server tmux nfs-common

    echo "Configuring SSH (example, may need adjustment)..."
    # The following commands are examples and might need interactive or more specific configuration.
    # sudo systemctl start ssh
    # sudo systemctl enable ssh
    # echo "WARNING: SSH configuration (e.g., /etc/ssh/sshd_config) should be manually reviewed and adjusted."
    # echo "WARNING: Firewall rules (UFW) for SSH may need to be configured manually (e.g., sudo ufw allow ssh)."
    
    echo "Installation of openssh-server and tmux complete."
    echo "Note: Further SSH configurations may be required manually."

    echo "Mounting NFS share..."
    sudo mkdir -p $LOCAL_NFS_MOUNT_POINT
    sudo mount -t nfs $REMOTE_NFS_MOUNT_POINT $LOCAL_NFS_MOUNT_POINT
    #sudo mount $REMOTE_NFS_MOUNT_POINT $LOCAL_NFS_MOUNT_POINT

    echo "NFS share mounted at $LOCAL_NFS_MOUNT_POINT"

    # Add to /etc/fstab to mount on boot
    FSTAB_ENTRY="$REMOTE_NFS_MOUNT_POINT    $LOCAL_NFS_MOUNT_POINT   nfs auto,nofail,noatime,nolock,intr,tcp,actimeo=1800 0 0"
    if ! grep -qF -- "$FSTAB_ENTRY" /etc/fstab; then
        echo "Adding NFS mount to /etc/fstab..."
        echo "$FSTAB_ENTRY" | sudo tee -a /etc/fstab > /dev/null
        echo "NFS mount added to /etc/fstab."
    else
        echo "NFS mount already exists in /etc/fstab."
    fi
else
    echo "Module 08: Installation of optional development tools skipped. Use --install-devtools to install them."
fi

echo "Module 08: Installation of optional development tools complete." 