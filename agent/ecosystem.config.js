// ---------------------------------------------------------------------------
// pm2 ecosystem config for VaultPrint Print Agent
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 logs vaultprint-agent
//   pm2 stop vaultprint-agent
//   pm2 restart vaultprint-agent
//   pm2 delete vaultprint-agent
//
// To auto-start on boot:
//   pm2 startup
//   pm2 save
// ---------------------------------------------------------------------------

module.exports = {
  apps: [
    {
      name: 'vaultprint-agent',
      script: './agent.js',
      cwd: __dirname,

      // Restart policy
      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s',
      restart_delay: 5000, // 5s between restarts

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Resource limits
      max_memory_restart: '200M',

      // Watch (disabled — agent is long-running, not file-dependent)
      watch: false,
    },
    {
      // Mode 2 file receiver — only started on Mode 2 (Android) kiosks:
      //   pm2 start ecosystem.config.js --only vaultprint-file-receiver
      // Standard kiosks:
      //   pm2 start ecosystem.config.js --only vaultprint-agent
      name: 'vaultprint-file-receiver',
      script: './file-receiver.js',
      cwd: __dirname,

      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s',
      restart_delay: 5000,

      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/receiver-error.log',
      out_file: './logs/receiver-out.log',
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
      },

      max_memory_restart: '200M',
      watch: false,
    },
  ],
}
