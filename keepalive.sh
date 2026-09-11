#!/bin/zsh
while true; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:4205/admin)
  if [ "$code" != "200" ]; then
    echo "$(date) preview dead ($code) — restarting" >> ~/.lh-sweep/admin/keepalive.log
    (cd ~/.lh-sweep/admin && npx vite preview --port 4205 --strictPort >> preview.log 2>&1 &)
    sleep 5
  fi
  sleep 3
done
