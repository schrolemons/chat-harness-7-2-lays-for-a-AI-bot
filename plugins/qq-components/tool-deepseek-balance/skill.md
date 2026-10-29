# DeepSeek API balance

Use `deepseek_balance` only in the administrator's private session when asked about the DSH/DeepSeek API account balance. The tool performs a read-only GET request and returns availability plus each currency's total, granted, and topped-up balance. Do not claim the DSH desktop subscription/account balance; this endpoint reports the API key's DeepSeek API account balance.

The API key remains in the bridge process environment (`DEEP_SEEK_KEY`, falling back to `DEEPSEEK_API_KEY`) and is never returned or logged. The tool has no input parameters.
