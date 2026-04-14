#!/usr/bin/env bash
# Claude Code status line: model name, token usage %, and estimated session cost

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // "Claude"')

used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
total_in=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_out=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')

# Estimate cost based on model family (approximate pricing per million tokens)
# Sonnet ~$3/M input, ~$15/M output; Haiku ~$0.25/M input, ~$1.25/M output; Opus ~$15/M input, ~$75/M output
model_id=$(echo "$input" | jq -r '.model.id // ""')
if echo "$model_id" | grep -qi "haiku"; then
  input_cost_per_m=0.25
  output_cost_per_m=1.25
elif echo "$model_id" | grep -qi "opus"; then
  input_cost_per_m=15.0
  output_cost_per_m=75.0
else
  # Default to Sonnet pricing
  input_cost_per_m=3.0
  output_cost_per_m=15.0
fi

cost=$(echo "$total_in $total_out $input_cost_per_m $output_cost_per_m" | awk '{
  cost = ($1 / 1000000 * $3) + ($2 / 1000000 * $4)
  printf "$%.4f", cost
}')

# Build status parts
parts=""

# Model name
parts="${model}"

# Token usage if available
if [ -n "$used_pct" ]; then
  used_int=$(printf "%.0f" "$used_pct")
  parts="${parts} | ctx: ${used_int}%"
fi

# Session cost
parts="${parts} | cost: ${cost}"

printf "%s" "$parts"
