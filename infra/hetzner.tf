# The Hetzner side: one server, a volume for the database, a firewall that lets nothing in.

resource "hcloud_ssh_key" "deploy" {
  name       = "haushaltsbuch-deploy"
  public_key = var.ssh_public_key
}

# No inbound rule at all: nothing on the internet can open a connection to the server. Outbound
# stays open (cloudflared dials out to Cloudflare, Docker pulls images, Ubuntu installs updates).
resource "hcloud_firewall" "closed" {
  name = "haushaltsbuch-closed"
}

# The server's own SSH host key, so the deploy job can verify it is talking to this server.
# Lives in the (encrypted) OpenTofu state.
resource "tls_private_key" "host" {
  algorithm = "ED25519"
}

# Postgres data. Survives a rebuilt server; protected twice against deletion (here and at Hetzner).
resource "hcloud_volume" "data" {
  name              = "haushaltsbuch-data"
  size              = var.volume_size
  location          = var.location
  format            = "ext4"
  delete_protection = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_server" "app" {
  name         = "haushaltsbuch"
  server_type  = var.server_type
  location     = var.location
  image        = "ubuntu-24.04"
  ssh_keys     = [hcloud_ssh_key.deploy.id]
  firewall_ids = [hcloud_firewall.closed.id]

  public_net {
    ipv4_enabled = true # needed: ghcr.io has no IPv6
    ipv6_enabled = true
  }

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    ssh_public_key   = var.ssh_public_key
    host_private_key = tls_private_key.host.private_key_openssh
    host_public_key  = tls_private_key.host.public_key_openssh
    volume_id        = hcloud_volume.data.id
    tunnel_token     = data.cloudflare_zero_trust_tunnel_cloudflared_token.app.token
  })

  lifecycle {
    # cloud-init only runs on the first boot. Changing it must not silently rebuild the server;
    # a rebuild is a deliberate step (README: "Rebuild the server").
    ignore_changes = [user_data, image, ssh_keys]
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.app.id
  automount = false # cloud-init mounts it at /mnt/data
}
