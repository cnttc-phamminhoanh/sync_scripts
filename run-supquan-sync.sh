#!/bin/bash

# Đường dẫn tuyệt đối đến thư mục dự án
PROJECT_DIR="/home/germton/germton_services/sync_scripts"

# Đường dẫn log file
LOG_FILE="$PROJECT_DIR/supquan-sync.log"

# Thêm npm/node vào PATH
export PATH="/home/germton/.nvm/versions/node/v22.23.2/bin:$PATH"

# Chuyển đến thư mục dự án
cd "$PROJECT_DIR" || exit 1

# Ghi log bắt đầu
echo "========================================" >> "$LOG_FILE"
echo "$(date) - 🔄 Start sync" >> "$LOG_FILE"

# Chạy script sync
npm run sync >> "$LOG_FILE" 2>&1

# Kiểm tra kết quả
if [ $? -eq 0 ]; then
  echo "✅ Sycn success" >> "$LOG_FILE"
else
  echo "❌ Sycn fail" >> "$LOG_FILE"
fi

echo "========================================" >> "$LOG_FILE"
