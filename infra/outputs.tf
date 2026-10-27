# Values the deploy job reads with `tofu output`, so nobody copies them by hand.

output "app_url" {
  value = "https://${local.app_host}"
}

output "ssh_host" {
  value = local.ssh_host
}

# Goes into known_hosts on the GitHub runner.
output "ssh_host_public_key" {
  value = trimspace(tls_private_key.host.public_key_openssh)
}

# The app checks Cloudflare's login token against this (IDENTITY_AUDIENCE).
output "access_audience" {
  value = cloudflare_zero_trust_access_application.app.aud
}

output "ssh_service_token_id" {
  value     = cloudflare_zero_trust_access_service_token.deploy.client_id
  sensitive = true
}

output "ssh_service_token_secret" {
  value     = cloudflare_zero_trust_access_service_token.deploy.client_secret
  sensitive = true
}

output "server_ipv4" {
  description = "Only for the Hetzner console; nothing can connect to it (firewall)."
  value       = hcloud_server.app.ipv4_address
}
