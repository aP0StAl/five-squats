(function () {
  "use strict";

  const STORAGE_KEY = "five-squats-state-v1";
  const LEGACY_STORAGE_KEYS = ["squads-control-state-v1"];
  const DEFAULT_SETTINGS = {
    startTime: "08:00",
    endTime: "22:00",
    ratePerHour: 5
  };

  const state = loadState();

  const elements = {
    catchUpNow: document.getElementById("catchUpNow"),
    statusNote: document.getElementById("statusNote"),
    progressFill: document.getElementById("progressFill"),
    progressText: document.getElementById("progressText"),
    doneToday: document.getElementById("doneToday"),
    remainingToday: document.getElementById("remainingToday"),
    expectedNow: document.getElementById("expectedNow"),
    undoButton: document.getElementById("undoButton"),
    settingsForm: document.getElementById("settingsForm"),
    startTime: document.getElementById("startTime"),
    endTime: document.getElementById("endTime"),
    ratePerHour: document.getElementById("ratePerHour"),
    exportButton: document.getElementById("exportButton"),
    importInput: document.getElementById("importInput"),
    historyList: document.getElementById("historyList"),
    historyRange: document.getElementById("historyRange"),
    historyTemplate: document.getElementById("historyItemTemplate")
  };

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      addEntry(Number(button.dataset.add));
    });
  });

  elements.undoButton.addEventListener("click", undoLastEntry);
  elements.settingsForm.addEventListener("submit", saveSettings);
  elements.exportButton.addEventListener("click", exportData);
  elements.importInput.addEventListener("change", importData);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  render();
  setInterval(render, 60 * 1000);

  function loadState() {
    const stored = readStoredState();
    const normalized = normalizeState(stored.value);

    if (stored.isLegacy) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }

    return normalized;
  }

  function readStoredState() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) {
        return { value: JSON.parse(current), isLegacy: false };
      }

      for (const key of LEGACY_STORAGE_KEYS) {
        const legacy = localStorage.getItem(key);
        if (legacy) {
          return { value: JSON.parse(legacy), isLegacy: true };
        }
      }
    } catch {
      return { value: null, isLegacy: false };
    }

    return { value: null, isLegacy: false };
  }

  function normalizeState(saved) {
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(saved && saved.settings ? saved.settings : {})
    };

    settings.ratePerHour = clampInteger(settings.ratePerHour, DEFAULT_SETTINGS.ratePerHour, 1, 200);
    settings.startTime = isTime(settings.startTime) ? settings.startTime : DEFAULT_SETTINGS.startTime;
    settings.endTime = isTime(settings.endTime) ? settings.endTime : DEFAULT_SETTINGS.endTime;

    if (minutesFromTime(settings.endTime) <= minutesFromTime(settings.startTime)) {
      settings.startTime = DEFAULT_SETTINGS.startTime;
      settings.endTime = DEFAULT_SETTINGS.endTime;
    }

    const entries = Array.isArray(saved && saved.entries)
      ? saved.entries
          .filter((entry) => {
            return entry &&
              Number.isFinite(Number(entry.amount)) &&
              entry.timestamp &&
              isValidDate(new Date(entry.timestamp));
          })
          .map((entry) => ({
            id: String(entry.id || cryptoId()),
            amount: clampInteger(entry.amount, 0, -10000, 10000),
            timestamp: String(entry.timestamp),
            date: isDateKey(entry.date) ? entry.date : dateKey(new Date(entry.timestamp))
          }))
      : [];

    return { settings, entries };
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function addEntry(amount) {
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    const now = new Date();
    state.entries.push({
      id: cryptoId(),
      amount,
      timestamp: now.toISOString(),
      date: dateKey(now)
    });
    persist();
    render();
  }

  function undoLastEntry() {
    const today = dateKey(new Date());
    for (let index = state.entries.length - 1; index >= 0; index -= 1) {
      if (entryDate(state.entries[index]) === today) {
        state.entries.splice(index, 1);
        persist();
        render();
        return;
      }
    }
  }

  function saveSettings(event) {
    event.preventDefault();

    const nextSettings = {
      startTime: elements.startTime.value,
      endTime: elements.endTime.value,
      ratePerHour: clampInteger(elements.ratePerHour.value, DEFAULT_SETTINGS.ratePerHour, 1, 200)
    };

    if (!isTime(nextSettings.startTime) || !isTime(nextSettings.endTime)) {
      return;
    }

    if (minutesFromTime(nextSettings.endTime) <= minutesFromTime(nextSettings.startTime)) {
      elements.statusNote.textContent = "Финиш должен быть позже старта.";
      return;
    }

    state.settings = nextSettings;
    persist();
    render();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `five-squats-${dateKey(new Date())}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        const imported = normalizeState(JSON.parse(String(reader.result)));
        state.settings = imported.settings;
        state.entries = imported.entries;
        persist();
        render();
      } catch {
        elements.statusNote.textContent = "Не получилось импортировать JSON.";
      } finally {
        elements.importInput.value = "";
      }
    });
    reader.readAsText(file);
  }

  function render() {
    const now = new Date();
    const today = dateKey(now);
    const doneToday = totalForDate(today);
    const target = dailyTarget(state.settings);
    const expected = expectedByNow(now, state.settings);
    const catchUpNow = Math.max(0, expected - doneToday);
    const remaining = Math.max(0, target - doneToday);
    const progress = target > 0 ? Math.min(100, Math.round((doneToday / target) * 100)) : 100;

    elements.startTime.value = state.settings.startTime;
    elements.endTime.value = state.settings.endTime;
    elements.ratePerHour.value = state.settings.ratePerHour;
    elements.catchUpNow.textContent = String(catchUpNow);
    elements.doneToday.textContent = String(doneToday);
    elements.remainingToday.textContent = String(remaining);
    elements.expectedNow.textContent = String(expected);
    elements.progressFill.style.width = `${progress}%`;
    elements.progressText.textContent = `${doneToday} из ${target}`;
    elements.undoButton.disabled = !hasEntriesForDate(today);
    elements.statusNote.textContent = statusNote(now, doneToday, expected, target, remaining);

    renderHistory(today);
  }

  function renderHistory(today) {
    const dates = recentDateKeys(14);
    elements.historyList.innerHTML = "";
    elements.historyRange.textContent = "Последние 14 дней";

    dates.forEach((key) => {
      const total = totalForDate(key);
      const target = dailyTarget(state.settings);
      const item = elements.historyTemplate.content.firstElementChild.cloneNode(true);
      const badge = item.querySelector(".history-badge");

      item.querySelector(".history-date").textContent = formatDate(key, key === today);
      item.querySelector(".history-summary").textContent = `${total} из ${target}`;

      if (total >= target) {
        badge.textContent = "готово";
      } else if (total > 0) {
        badge.textContent = `-${target - total}`;
        badge.classList.add("miss");
      } else {
        badge.textContent = "пусто";
        badge.classList.add("empty");
      }

      elements.historyList.append(item);
    });
  }

  function statusNote(now, done, expected, target, remaining) {
    const start = minutesFromTime(state.settings.startTime);
    const end = minutesFromTime(state.settings.endTime);
    const current = now.getHours() * 60 + now.getMinutes();

    if (current < start) {
      return `До ${state.settings.startTime} можно не спешить. План на день: ${target}.`;
    }

    if (remaining === 0) {
      return "Дневной план закрыт.";
    }

    if (current >= end) {
      return `День почти закончился. Осталось ${remaining}.`;
    }

    if (done > expected) {
      return `Есть запас: ${done - expected}. До дневного плана осталось ${remaining}.`;
    }

    if (done === expected) {
      return `Идешь ровно по плану. До вечера осталось ${remaining}.`;
    }

    return `Чтобы догнать план, сделай еще ${expected - done}.`;
  }

  function dailyTarget(settings) {
    const start = minutesFromTime(settings.startTime);
    const end = minutesFromTime(settings.endTime);
    return Math.max(0, Math.round(((end - start) / 60) * settings.ratePerHour));
  }

  function expectedByNow(now, settings) {
    const start = minutesFromTime(settings.startTime);
    const end = minutesFromTime(settings.endTime);
    const current = now.getHours() * 60 + now.getMinutes();

    if (current <= start) {
      return 0;
    }

    const cappedCurrent = Math.min(current, end);
    const elapsedHours = (cappedCurrent - start) / 60;
    return Math.floor(elapsedHours * settings.ratePerHour);
  }

  function totalForDate(key) {
    return state.entries.reduce((sum, entry) => {
      return entryDate(entry) === key ? sum + entry.amount : sum;
    }, 0);
  }

  function hasEntriesForDate(key) {
    return state.entries.some((entry) => entryDate(entry) === key);
  }

  function entryDate(entry) {
    return isDateKey(entry.date) ? entry.date : dateKey(new Date(entry.timestamp));
  }

  function recentDateKeys(days) {
    const keys = [];
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);

    for (let index = 0; index < days; index += 1) {
      keys.push(dateKey(cursor));
      cursor.setDate(cursor.getDate() - 1);
    }

    return keys;
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDate(key, isToday) {
    if (isToday) {
      return "Сегодня";
    }

    const [year, month, day] = key.split("-").map(Number);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      weekday: "short"
    }).format(new Date(year, month - 1, day));
  }

  function minutesFromTime(value) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function isTime(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function isDateKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
  }

  function clampInteger(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, number));
  }

  function cryptoId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
})();
