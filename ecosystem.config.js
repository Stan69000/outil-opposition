module.exports = {
  apps: [{
    name: "fleurieux-opposition",
    script: "./server/index.js",
    env: {
      NODE_ENV: "production",
      PORT: 3001,
    },
    node_args: "--no-warnings",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "256M",
    error_file: "./logs/error.log",
    out_file: "./logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
  }],
};
