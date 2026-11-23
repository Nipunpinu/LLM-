(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const els = {
    apiKey: $("#api-key"),
    rememberKey: $("#remember-key"),
    model: $("#model-select"),
    activeModel: $("#active-model"),
    temperature: $("#temperature"),
    temperatureValue: $("#temperature-value"),
    maxTokens: $("#max-tokens"),
    maxTokensValue: $("#max-tokens-value"),
    systemPrompt: $("#system-prompt"),
    stopSequences: $("#stop-sequences"),
    topP: $("#top-p"),
    prompt: $("#prompt-input"),
    send: $("#send-button"),
    sendLabel: $("#send-label"),
    conversation: $("#conversation"),
    messages: $("#messages"),
    welcome: $("#welcome"),
    error: $("#error-banner"),
    connection: $("#connection-label"),
    statusDot: $(".status-dot"),
    turnCount: $("#turn-count"),
    charCount: $("#char-count"),
    wordCount: $("#word-count"),
    promptScore: $("#prompt-score"),
    scoreMeter: $("#score-meter-fill"),
    promptSignals: $("#prompt-signals"),
    estimatedTokens: $("#estimated-tokens"),
    metricsStatus: $("#metrics-status"),
    ttft: $("#ttft-value"),
    totalTime: $("#total-time-value"),
    tokensPerSecond: $("#tokens-per-second"),
    inputTokens: $("#input-tokens"),
    outputTokens: $("#output-tokens"),
    totalTokens: $("#total-tokens")
  };
  const modelLabels = new Map(Array.from(els.model.options, (option) => [option.value, option.textContent.trim().toUpperCase()]));
  const conversation = [];
  let requestController = null;
  let requestId = 0;
  let sending = false;
  let pendingAssistant = null;

  function setRangeProgress(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const progress = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--range-progress", `${progress}%`);
  }

  function syncModel() {
    els.activeModel.textContent = modelLabels.get(els.model.value) || els.model.value.toUpperCase();
  }

  function syncSettings() {
    els.temperatureValue.textContent = Number(els.temperature.value).toFixed(2);
    els.maxTokensValue.textContent = Number(els.maxTokens.value).toLocaleString();
    setRangeProgress(els.temperature);
    setRangeProgress(els.maxTokens);
  }

  function updatePromptAnalysis() {
    const prompt = els.prompt.value.trim();
    const words = prompt.match(/\S+/g) || [];
    els.charCount.textContent = els.prompt.value.length.toLocaleString();
    els.wordCount.textContent = words.length.toLocaleString();
    const estimated = prompt ? Math.max(1, Math.ceil(prompt.length / 4)) : 0;
    els.estimatedTokens.textContent = prompt ? `~${estimated.toLocaleString()}` : "—";

    if (!prompt) {
      els.promptScore.textContent = "—";
      els.scoreMeter.style.width = "0%";
      els.promptSignals.innerHTML = '<div class="signal-row muted"><span class="signal-mark">○</span><span>Waiting for your prompt</span><span class="signal-value">—</span></div>';
      return;
    }

    const signals = [
      { label: "Clear instruction", pass: /\b(explain|write|summari[sz]e|list|compare|describe|create|translate|classify|analy[sz]e|give|tell|generate|draft|help|make|review|rewrite|build)\b/i.test(prompt) },
      { label: "Useful context", pass: words.length >= 12 },
      { label: "Specific constraints", pass: /\b(in|under|exactly|only|no more than|at least|format|limit|include|exclude|must|don't|do not)\b/i.test(prompt) },
      { label: "Output format", pass: /\b(bullet|json|table|paragraph|steps|format|list|csv|markdown|sentence|email|code)\b/i.test(prompt) }
    ];
    const score = Math.round(signals.filter((signal) => signal.pass).length / signals.length * 100);
    els.promptScore.textContent = String(score).padStart(2, "0");
    els.scoreMeter.style.width = `${score}%`;
    els.promptSignals.innerHTML = signals.map((signal) => `<div class="signal-row${signal.pass ? "" : " miss"}"><span class="signal-mark">${signal.pass ? "✓" : "○"}</span><span>${signal.label}</span><span class="signal-value">${signal.pass ? "FOUND" : "—"}</span></div>`).join("");
  }

  function setBusy(busy) {
    sending = busy;
    els.send.classList.toggle("is-stop", busy);
    els.sendLabel.textContent = busy ? "Stop response" : "Send prompt";
    els.send.querySelector(".send-arrow").textContent = busy ? "■" : "↗";
    els.send.disabled = false;
    els.statusDot.classList.toggle("busy", busy);
    els.connection.textContent = busy
      ? "GENERATING RESPONSE"
      : (!els.error.hidden
        ? "REQUEST NEEDS ATTENTION"
        : (els.apiKey.value.trim() ? "KEY READY · DIRECT TO GROQ" : "READY WHEN YOU ARE"));
    els.metricsStatus.textContent = busy ? "STREAMING" : "IDLE";
    els.metricsStatus.classList.toggle("active", busy);
  }

  function clearError() {
    els.error.hidden = true;
    els.error.textContent = "";
    els.statusDot.classList.remove("error");
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
    els.statusDot.classList.add("error");
    els.connection.textContent = "REQUEST NEEDS ATTENTION";
  }

  function scrollToLatest() {
    els.conversation.scrollTop = els.conversation.scrollHeight;
  }

  function addMessage(role, content, streaming = false) {
    els.welcome.hidden = true;
    const article = document.createElement("article");
    article.className = `message ${role}`;
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const roleLabel = document.createElement("span");
    roleLabel.className = "message-role";
    const mark = document.createElement("i");
    mark.className = "message-role-mark";
    const label = document.createElement("span");
    label.textContent = role === "user" ? "YOU" : "MODEL";
    roleLabel.append(mark, label);
    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    meta.append(roleLabel, time);
    const body = document.createElement("div");
    body.className = "message-content";
    body.textContent = content;
    if (streaming) {
      const cursor = document.createElement("span");
      cursor.className = "message-cursor";
      body.append(cursor);
    }
    article.append(meta, body);
    els.messages.append(article);
    scrollToLatest();
    return { article, body };
  }

  function addMessageActions(article, content) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "message-action";
    copy.textContent = "COPY";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(content);
        copy.textContent = "COPIED";
        window.setTimeout(() => { copy.textContent = "COPY"; }, 1400);
      } catch {
        copy.textContent = "COPY UNAVAILABLE";
      }
    });
    actions.append(copy);
    article.append(actions);
  }

  function updateTurns() {
    const turns = conversation.filter((item) => item.role === "user").length;
    els.turnCount.textContent = `${turns} ${turns === 1 ? "TURN" : "TURNS"}`;
  }

  function resetMetrics() {
    els.ttft.textContent = "—";
    els.totalTime.textContent = "—";
    els.tokensPerSecond.textContent = "—";
    els.inputTokens.textContent = "—";
    els.outputTokens.textContent = "—";
    els.totalTokens.textContent = "—";
    els.metricsStatus.textContent = "IDLE";
    els.metricsStatus.classList.remove("active");
  }

  function clearConversation() {
    if (sending) {
      requestId += 1;
      requestController?.abort();
    }
    conversation.length = 0;
    pendingAssistant = null;
    els.messages.replaceChildren();
    els.welcome.hidden = false;
    els.prompt.value = "";
    updatePromptAnalysis();
    updateTurns();
    resetMetrics();
    clearError();
    setBusy(false);
    els.prompt.focus();
  }

  function friendlyApiError(status, body) {
    let detail = "";
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error?.message || parsed.message || "";
    } catch {
      detail = body.slice(0, 240);
    }
    if (status === 401) return "That API key was not accepted. Check the key and try again.";
    if (status === 429) return "Groq's rate limit was reached. Give it a moment, then try again.";
    if (status === 400 && /model/i.test(detail)) return `The selected model may be unavailable: ${detail}`;
    return detail || `Groq returned HTTP ${status}. Check your model and API key, then try again.`;
  }

  function getUsageFromEvent(data) {
    if (!data || typeof data !== "object" || !data.usage) return null;
    return {
      prompt: Number(data.usage.prompt_tokens) || 0,
      completion: Number(data.usage.completion_tokens) || 0,
      total: Number(data.usage.total_tokens) || 0
    };
  }

  async function sendPrompt() {
    if (sending) {
      requestController?.abort();
      return;
    }
    const prompt = els.prompt.value.trim();
    if (!prompt) {
      els.prompt.focus();
      return;
    }
    const apiKey = els.apiKey.value.trim();
    if (!apiKey) {
      showError("Add your Groq API key in Model setup to start chatting. Your key is sent directly to Groq and is not stored unless you choose to remember it for this session.");
      els.apiKey.focus();
      return;
    }

    clearError();
    const userMessage = { role: "user", content: prompt };
    conversation.push(userMessage);
    const userView = addMessage("user", prompt);
    els.prompt.value = "";
    updatePromptAnalysis();
    updateTurns();
    resetMetrics();
    setBusy(true);

    const assistantView = addMessage("assistant", "", true);
    pendingAssistant = assistantView;
    requestController = new AbortController();
    const thisRequestId = ++requestId;
    const startedAt = performance.now();
    let firstTokenAt = null;
    let responseText = "";
    let usage = null;
    const stop = els.stopSequences.value.split(",").map((sequence) => sequence.trim()).filter(Boolean).slice(0, 4);
    const messages = [];
    if (els.systemPrompt.value.trim()) messages.push({ role: "system", content: els.systemPrompt.value.trim() });
    messages.push(...conversation);
    const payload = {
      model: els.model.value,
      messages,
      temperature: Number(els.temperature.value),
      max_tokens: Number(els.maxTokens.value),
      top_p: Math.min(1, Math.max(0, Number(els.topP.value) || 0)),
      stream: true,
      stream_options: { include_usage: true }
    };
    if (stop.length) payload.stop = stop;

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: requestController.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(friendlyApiError(response.status, body));
      }
      if (!response.body) throw new Error("This browser cannot read the response stream. Try a current version of Chrome, Firefox, or Safari.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamEnded = false;

      while (!streamEnded) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n");
        buffer = events.pop() || "";

        for (const rawLine of events) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const dataText = line.slice(5).trim();
          if (dataText === "[DONE]") {
            streamEnded = true;
            break;
          }
          let data;
          try { data = JSON.parse(dataText); } catch { continue; }
          if (data.error) throw new Error(data.error.message || "The model returned an error during streaming.");
          usage = getUsageFromEvent(data) || usage;
          const delta = data.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            if (firstTokenAt === null) {
              firstTokenAt = performance.now();
              els.ttft.textContent = Math.round(firstTokenAt - startedAt).toLocaleString();
              els.metricsStatus.textContent = "STREAMING";
            }
            responseText += delta;
            assistantView.body.textContent = responseText;
            const cursor = document.createElement("span");
            cursor.className = "message-cursor";
            assistantView.body.append(cursor);
            scrollToLatest();
          }
        }
      }

      if (buffer.trim().startsWith("data:")) {
        const finalData = buffer.trim().slice(5).trim();
        if (finalData && finalData !== "[DONE]") {
          try {
            const parsed = JSON.parse(finalData);
            usage = getUsageFromEvent(parsed) || usage;
          } catch { /* A truncated terminal event has no additional displayable content. */ }
        }
      }
      await reader.cancel();
      finishResponse(responseText, assistantView, usage, startedAt, firstTokenAt);
    } catch (error) {
      if (thisRequestId !== requestId) return;
      if (error.name === "AbortError") {
        const finished = performance.now();
        const partial = responseText.trim();
        if (partial) {
          conversation.push({ role: "assistant", content: partial });
          assistantView.body.textContent = partial;
          addMessageActions(assistantView.article, partial);
        } else {
          assistantView.article.remove();
        }
        setResponseMetrics(startedAt, firstTokenAt, finished, usage);
        updateTurns();
      } else {
        assistantView.article.remove();
        userView.article.remove();
        conversation.pop();
        updateTurns();
        els.prompt.value = prompt;
        updatePromptAnalysis();
        showError(error.message || "The request could not be completed. Check your connection and try again.");
      }
    } finally {
      if (thisRequestId === requestId) {
        pendingAssistant = null;
        requestController = null;
        setBusy(false);
      }
    }
  }

  function setResponseMetrics(startedAt, firstTokenAt, finished, usage) {
    const durationMs = Math.max(1, finished - startedAt);
    els.totalTime.textContent = (durationMs / 1000).toFixed(2);
    const generated = usage?.completion || 0;
    if (generated) {
      const generationMs = Math.max(1, finished - (firstTokenAt ?? startedAt));
      els.tokensPerSecond.textContent = (generated / (generationMs / 1000)).toFixed(1);
    }
    if (usage) {
      els.inputTokens.textContent = usage.prompt.toLocaleString();
      els.outputTokens.textContent = usage.completion.toLocaleString();
      els.totalTokens.textContent = usage.total.toLocaleString();
    }
  }

  function finishResponse(responseText, view, usage, startedAt, firstTokenAt) {
    const cleanText = responseText.trim();
    if (!cleanText) {
      view.article.remove();
      if (!usage) showError("The model returned an empty response. Try a different model or a larger token limit.");
    } else {
      conversation.push({ role: "assistant", content: cleanText });
      view.body.textContent = cleanText;
      addMessageActions(view.article, cleanText);
    }
    const finished = performance.now();
    setResponseMetrics(startedAt, firstTokenAt, finished, usage);
    els.metricsStatus.textContent = usage ? "COMPLETE" : "DONE";
    updateTurns();
  }

  async function refreshModels() {
    const apiKey = els.apiKey.value.trim();
    if (!apiKey) {
      showError("Add your Groq API key first to load the models available to your account.");
      els.apiKey.focus();
      return;
    }
    clearError();
    const button = $("#refresh-models");
    button.disabled = true;
    button.textContent = "↻  Loading models…";
    try {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(friendlyApiError(response.status, body));
      }
      const result = await response.json();
      const available = (result.data || []).filter((model) => model.id && !model.id.includes("whisper") && !model.id.includes("guard"));
      if (!available.length) throw new Error("No chat models were returned for this API key.");
      const current = els.model.value;
      const options = available.map((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = (model.id === current ? modelLabels.get(current) : null) || model.id;
        return option;
      });
      els.model.replaceChildren(...options);
      if (available.some((model) => model.id === current)) els.model.value = current;
      modelLabels.clear();
      for (const option of els.model.options) modelLabels.set(option.value, option.textContent.toUpperCase());
      syncModel();
      els.connection.textContent = "MODELS REFRESHED";
    } catch (error) {
      showError(error.message || "Couldn't load the available models. Check your key and try again.");
    } finally {
      button.disabled = false;
      button.textContent = "↻   Refresh available models";
    }
  }

  els.temperature.addEventListener("input", syncSettings);
  els.maxTokens.addEventListener("input", syncSettings);
  els.model.addEventListener("change", syncModel);
  els.prompt.addEventListener("input", updatePromptAnalysis);
  els.send.addEventListener("click", sendPrompt);
  $("#refresh-models").addEventListener("click", refreshModels);
  $("#reset-chat").addEventListener("click", clearConversation);
  $("#clear-conversation").addEventListener("click", clearConversation);
  $("#toggle-key").addEventListener("click", (event) => {
    const revealed = els.apiKey.type === "password";
    els.apiKey.type = revealed ? "text" : "password";
    event.currentTarget.setAttribute("aria-label", revealed ? "Hide API key" : "Show API key");
    event.currentTarget.title = revealed ? "Hide API key" : "Show API key";
  });
  $("#clear-key").addEventListener("click", () => {
    els.apiKey.value = "";
    els.rememberKey.checked = false;
    sessionStorage.removeItem("ochre-groq-api-key");
    els.connection.textContent = "READY WHEN YOU ARE";
    clearError();
  });
  els.apiKey.addEventListener("input", () => {
    clearError();
    if (!sending) els.connection.textContent = els.apiKey.value.trim() ? "KEY READY · DIRECT TO GROQ" : "READY WHEN YOU ARE";
    if (els.rememberKey.checked) sessionStorage.setItem("ochre-groq-api-key", els.apiKey.value);
  });
  els.rememberKey.addEventListener("change", () => {
    if (els.rememberKey.checked && els.apiKey.value) sessionStorage.setItem("ochre-groq-api-key", els.apiKey.value);
    else sessionStorage.removeItem("ochre-groq-api-key");
  });
  $("#top-p").addEventListener("change", () => {
    const value = Number(els.topP.value);
    if (!els.topP.value.trim() || !Number.isFinite(value)) els.topP.value = "1";
    else els.topP.value = String(Math.min(1, Math.max(0, value)));
  });
  document.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      els.prompt.value = button.dataset.prompt || "";
      updatePromptAnalysis();
      els.prompt.focus();
    });
  });
  els.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sending) requestController?.abort();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendPrompt();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sending) requestController?.abort();
  });

  const rememberedKey = sessionStorage.getItem("ochre-groq-api-key");
  if (rememberedKey) {
    els.apiKey.value = rememberedKey;
    els.rememberKey.checked = true;
    els.connection.textContent = "KEY READY · DIRECT TO GROQ";
  }
  syncSettings();
  syncModel();
  updatePromptAnalysis();
})();
