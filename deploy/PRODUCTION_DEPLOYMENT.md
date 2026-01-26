# Production Deployment Guide: aztec-pay.xyz

## Overview

| Service | Domain | Internal Port | External |
|---------|--------|---------------|----------|
| Frontend | aztec-pay.xyz | 5173 | 443 (HTTPS) |
| Backend API | api.aztec-pay.xyz | 3001 | 443 (HTTPS) |
| Aztec Node | aztec-node.aztec-pay.xyz | 8080 | 443 (HTTPS) |

**Features:**
- SSL via Let's Encrypt (auto-renewal)
- Rate limiting: 150 requests/minute per IP
- All internal ports bound to localhost only

---

## Step 1: DNS Configuration (GoDaddy)

Add these A records pointing to your server's public IP:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | YOUR_SERVER_IP | 600 |
| A | www | YOUR_SERVER_IP | 600 |
| A | api | YOUR_SERVER_IP | 600 |
| A | aztec-node | YOUR_SERVER_IP | 600 |

**Wait 5-10 minutes for DNS propagation before proceeding.**

Verify with:
```bash
dig aztec-pay.xyz +short
dig api.aztec-pay.xyz +short
dig aztec-node.aztec-pay.xyz +short
```

---

## Step 2: Install Nginx & Certbot

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# Start nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## Step 3: Install Nginx Configuration

Copy the contents of `nginx-aztec-pay.conf` to your server:

```bash
sudo nano /etc/nginx/sites-available/aztec-pay
```

Paste the entire contents of `nginx-aztec-pay.conf` from this directory.

Then enable the site:

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/aztec-pay /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

---

## Step 4: Obtain SSL Certificates

```bash
sudo certbot --nginx \
  -d aztec-pay.xyz \
  -d www.aztec-pay.xyz \
  -d api.aztec-pay.xyz \
  -d aztec-node.aztec-pay.xyz
```

Follow the prompts:
1. Enter email for renewal notifications
2. Agree to terms
3. Choose to redirect HTTP to HTTPS (recommended)

Certbot automatically:
- Obtains certificates
- Modifies nginx config for SSL
- Sets up auto-renewal

Verify auto-renewal:
```bash
sudo certbot renew --dry-run
```

---

## Step 5: Configure Firewall

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (certbot renewal)
sudo ufw allow 443/tcp   # HTTPS

# Enable firewall
sudo ufw enable

# Verify
sudo ufw status
```

**Do NOT expose** ports 3001, 5173, 8080, 8545, 40400 directly.

---

## Step 6: Clone and Configure Application

```bash
# Clone repository
git clone https://github.com/YOUR_REPO/aztec-pay.git
cd aztec-pay

# Create production .env file
cp deploy/.env.production.example .env

# Edit with your production values
nano .env
```

**Important:**
- Replace `EVM_PRIVATE_KEY` with your production wallet key
- Set `AZTEC_NODE_URL=https://aztec-node.aztec-pay.xyz` for the frontend to connect to your public Aztec node

### Environment Variables

| Variable | Used By | Description | Default |
|----------|---------|-------------|---------|
| `AZTEC_NODE_URL` | Frontend (build-time) | Public URL for browser to connect to Aztec | `http://localhost:8080` |
| `API_BASE_URL` | Frontend (build-time) | Public URL for browser to call backend API | Empty (uses nginx proxy) |
| `API_URL` | Webpack dev server | Backend API URL (not needed in Docker) | `http://localhost:3001` |
| `EVM_PRIVATE_KEY` | Backend (runtime) | Private key for bridge transactions | Required |
| `EVM_RPC_URL` | Backend (runtime) | Base Sepolia RPC endpoint | `https://sepolia.base.org` |
| `EVM_TOKEN_ADDRESS` | Backend (runtime) | ERC20 token contract address | Required |

**Note on API_BASE_URL:**
- If empty (default), frontend uses relative URLs (`/api/*`) which nginx proxies to the backend
- For production with separate domains, set to `https://api.aztec-pay.xyz`

---

## Step 7: Deploy Application

```bash
# Build and start all services
# The AZTEC_NODE_URL from .env will be baked into the frontend at build time
docker-compose --profile local-network --profile app up -d --build

# Or explicitly pass the Aztec node URL as a build arg:
AZTEC_NODE_URL=https://aztec-node.aztec-pay.xyz docker-compose --profile local-network --profile app up -d --build

# Check status
docker ps

# View logs
docker-compose logs -f
```

**Note:** The `AZTEC_NODE_URL` is baked into the frontend JavaScript bundle at build time. If you change this value, you must rebuild the frontend container.

---

## Step 8: Verification Checklist

Run these checks to verify deployment:

```bash
# Check DNS
dig aztec-pay.xyz +short
dig api.aztec-pay.xyz +short
dig aztec-node.aztec-pay.xyz +short

# Check SSL certificates
curl -I https://aztec-pay.xyz
curl -I https://api.aztec-pay.xyz
curl -I https://aztec-node.aztec-pay.xyz

# Check services
curl https://api.aztec-pay.xyz/api/health
curl https://aztec-node.aztec-pay.xyz/status

# Test rate limiting (should see 503 after burst)
ab -n 200 -c 10 https://api.aztec-pay.xyz/api/health
```

---

## Troubleshooting

### Nginx won't start
```bash
sudo nginx -t                    # Check config syntax
sudo journalctl -u nginx -f      # View nginx logs
```

### SSL certificate issues
```bash
sudo certbot certificates        # List certificates
sudo certbot renew --dry-run     # Test renewal
```

### Docker issues
```bash
docker-compose logs backend      # Backend logs
docker-compose logs frontend     # Frontend logs
docker-compose logs aztec        # Aztec node logs
docker-compose restart           # Restart all services
```

### Check if ports are bound correctly
```bash
sudo netstat -tlnp | grep -E '3001|5173|8080'
# Should show 127.0.0.1:PORT (localhost only)
```

---

## Maintenance

### Update application
```bash
cd /path/to/aztec-pay
git pull origin main
docker-compose --profile local-network --profile app up -d --build
```

### View logs
```bash
docker-compose logs -f --tail=100
```

### Restart services
```bash
docker-compose restart
```

### SSL certificate renewal (automatic, but can force)
```bash
sudo certbot renew
```

---

## Rate Limiting Details

- **Zone**: `aztec_limit` with 10MB shared memory
- **Rate**: 150 requests per minute (2.5 req/sec)
- **Burst**: 20 requests allowed in short bursts
- **Behavior**: Returns 503 when rate exceeded

---

## Files Modified

| File | Change |
|------|--------|
| `docker-compose.yml` | Ports bound to 127.0.0.1, build args for frontend config |
| `Dockerfile` | Added build args for AZTEC_NODE_URL, API_BASE_URL, API_URL |
| `app/main.ts` | Uses API_BASE_URL env variable for backend calls |
| `app/claim.ts` | Uses API_BASE_URL env variable for backend calls |
| `src/web/aztec-client.ts` | Uses AZTEC_NODE_URL env variable |
| `deploy/nginx-aztec-pay.conf` | Production nginx config (copy to server) |
| `deploy/.env.production.example` | Template for production environment |
