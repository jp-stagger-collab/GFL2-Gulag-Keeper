// ==UserScript==
// @name         솦챈 굴라그 키퍼
// @namespace    https://arca.live/
// @version      0.4.2
// @description  Replace arca.live block/report block flows with a custom UI for one channel.
// @match        https://arca.live/b/gilrsfrontline2exili*
// @match        https://arca.live/reports/b/gilrsfrontline2exili/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jp-stagger-collab/GFL2-Gulag-Keeper/main/gfl2-gulag-keeper.user.js
// @downloadURL  https://raw.githubusercontent.com/jp-stagger-collab/GFL2-Gulag-Keeper/main/gfl2-gulag-keeper.user.js
// ==/UserScript==

(function () {
  'use strict';

  const MARK_SOURCE = 'arcaCustomBlockSource';
  const MARK_FAKE = 'arcaCustomBlockFake';
  const MODAL_ID = 'arca-custom-block-ui-modal';
  const MANAGER_ID = 'arca-custom-block-manager-ui';
  const STYLE_ID = 'arca-custom-block-ui-style';
  const LAST_DURATION_KEY = 'arcaCustomBlockUi:lastDuration';
  const SUPABASE_SESSION_KEY = 'arcaCustomBlockUi:supabaseSession';
  const SUPABASE_ADMIN_KEY = 'arcaCustomBlockUi:supabaseAdmin';
  const BOARD_PREFIX = 'https://arca.live/b/gilrsfrontline2exili';
  const BLOCKED_PREFIX = `${BOARD_PREFIX}/blocked`;
  const REPORT_PREFIX = 'https://arca.live/reports/b/gilrsfrontline2exili/';
  const SUPABASE_URL = 'https://yzyfuzhefelobmiqpxtl.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6eWZ1emhlZmVsb2JtaXFweHRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NTE0NDMsImV4cCI6MjA5ODUyNzQ0M30.Zxyt2alb-syagGCNZfZifwrhjM5QkKRKeJle4YY9ds8';
  const SUPABASE_LOGIN_EMAIL = 'arca-log@gfl2.com';

  function getPageMode() {
    const href = location.href;

    if (href.startsWith(REPORT_PREFIX)) return 'report';
    if (href === BLOCKED_PREFIX || href.startsWith(`${BLOCKED_PREFIX}?`) || href.startsWith(`${BLOCKED_PREFIX}#`)) return 'blocked';
    if (href === BOARD_PREFIX || href.startsWith(`${BOARD_PREFIX}/`) || href.startsWith(`${BOARD_PREFIX}?`) || href.startsWith(`${BOARD_PREFIX}#`)) {
      return 'board';
    }

    return null;
  }

  const PAGE_MODE = getPageMode();
  if (!PAGE_MODE) return;

  const BOARD_PRESETS = [
    ['6시간', '1*0.25'],
    ['12시간', '1*0.5'],
    ['1일', '1'],
    ['3일', '3'],
    ['7일', '7'],
    ['30일', '30'],
    ['180일', '180'],
    ['1년', '365'],
  ];

  const REPORT_DURATION_OPTIONS = [
    { label: '6시간', days: '1*0.25', hours: 6 },
    { label: '1일', days: '1', hours: 24 },
    { label: '3일', days: '3', hours: 72 },
    { label: '7일', days: '7', hours: 168 },
    { label: '1개월', days: '30', hours: 720 },
    { label: '1년', days: '365', hours: 8760, match: /1년|갱차|깡계/ },
  ];
  const REPORT_PRESETS = REPORT_DURATION_OPTIONS.map((option) => [option.label, option.days]);

  const REPORT_IGNORED_ACTIONS = new Set(['사유아님', '처리완료']);
  const bypassReportActionButtons = new WeakSet();

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function compactText(value) {
    return normalizeText(value).replace(/\s+/g, '');
  }

  function getControlText(el) {
    if (!el) return '';
    if (el instanceof HTMLInputElement) return normalizeText(el.value);
    return normalizeText(el.textContent);
  }

  function isBlockButton(el) {
    if (!el || el.dataset[MARK_SOURCE] || el.dataset[MARK_FAKE]) return false;
    if (el.closest(`#${MODAL_ID}`)) return false;
    return getControlText(el) === '차단';
  }

  function selectHasDirectInput(select) {
    return Array.from(select.options || []).some((option) => {
      return compactText(option.textContent) === '직접입력';
    });
  }

  function findDirectInputOption(select) {
    return Array.from(select.options || []).find((option) => {
      return compactText(option.textContent) === '직접입력';
    });
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  function cleanTargetLabel(value) {
    return normalizeText(value)
      .replace(/\s*\(현재\s*채널\s*비율\s*:\s*\d+%\)\s*/g, ' ')
      .replace(/\s*\(current\s+channel\s+ratio\s*:\s*\d+%\)\s*/gi, ' ')
      .trim();
  }

  function findBlockSelect(button) {
    const roots = uniqueElements([
      button.parentElement,
      button.closest('.info-row'),
      button.closest('.article-head'),
      button.closest('.comment-info'),
      button.closest('.comment-wrapper'),
      button.closest('.comment-item'),
      button.closest('.reply-item'),
      button.closest('li'),
      button.closest('tr'),
    ]);

    for (const root of roots) {
      const selects = Array.from(root.querySelectorAll('select')).filter(selectHasDirectInput);
      if (selects.length) return selects[selects.length - 1];
    }

    let prev = button.previousElementSibling;
    while (prev) {
      if (prev instanceof HTMLSelectElement && selectHasDirectInput(prev)) return prev;
      const nested = prev.querySelector && Array.from(prev.querySelectorAll('select')).find(selectHasDirectInput);
      if (nested) return nested;
      prev = prev.previousElementSibling;
    }

    return null;
  }

  function findTargetLabel(button, select) {
    const root = button.closest('.info-row, .comment-info, .article-head, .comment-wrapper, .comment-item, .reply-item') || button.parentElement;
    if (!root) return '';

    if (select) {
      const nicknameLink = Array.from(root.querySelectorAll('a')).find((link) => {
        const text = cleanTargetLabel(link.textContent);
        if (!text || text === '차단') return false;
        return Boolean(link.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING);
      });

      if (nicknameLink) {
        return cleanTargetLabel(nicknameLink.textContent).slice(0, 80);
      }
    }

    const raw = normalizeText(root.textContent);
    const selectText = normalizeText(select && select.options && select.options[select.selectedIndex] && select.options[select.selectedIndex].textContent);
    const beforeSelect = selectText ? raw.split(selectText)[0] : raw.split('차단')[0];
    return cleanTargetLabel(beforeSelect).slice(0, 80);
  }

  function findTargetProfileUrl(button, select) {
    const root = button.closest('.info-row, .comment-info, .article-head, .comment-wrapper, .comment-item, .reply-item') || button.parentElement;
    if (!root) return '';

    const targetLabel = findTargetLabel(button, select);
    const link = Array.from(root.querySelectorAll('a[href]')).find((candidate) => {
      return cleanTargetLabel(candidate.textContent) === targetLabel;
    });

    return link ? absoluteUrl(link.getAttribute('href')) : '';
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .arca-custom-block-ui-hidden-source {
        display: none !important;
      }

      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.36);
        color: #f5f5f7;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${MODAL_ID} .acbu-dialog {
        width: min(440px, calc(100vw - 28px));
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 8px;
        background: rgba(32, 33, 38, 0.75);
        box-shadow: 0 18px 52px rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }

      #${MODAL_ID} .acbu-head,
      #${MODAL_ID} .acbu-body,
      #${MODAL_ID} .acbu-actions {
        padding: 14px 16px;
      }

      #${MODAL_ID} .acbu-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      #${MODAL_ID} .acbu-title {
        font-size: 15px;
        font-weight: 700;
      }

      #${MODAL_ID} .acbu-close {
        border: 0;
        background: transparent;
        color: #d7d7dc;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 0 2px;
      }

      #${MODAL_ID} .acbu-target {
        margin-bottom: 6px;
        color: #d8d8dd;
        font-size: 13px;
        word-break: break-all;
      }

      #${MODAL_ID} .acbu-url {
        margin-bottom: 12px;
      }

      #${MODAL_ID} label {
        display: block;
        margin: 10px 0 6px;
        color: #f0f0f3;
        font-size: 13px;
        font-weight: 600;
      }

      #${MODAL_ID} input,
      #${MODAL_ID} textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 6px;
        background: #14151a;
        color: #ffffff;
        font: inherit;
        outline: none;
        padding: 9px 10px;
      }

      #${MODAL_ID} textarea {
        min-height: 82px;
        resize: vertical;
      }

      #${MODAL_ID} input:focus,
      #${MODAL_ID} textarea:focus {
        border-color: #ff8ac8;
        box-shadow: 0 0 0 2px rgba(255, 138, 200, 0.18);
      }

      #${MODAL_ID} .acbu-presets {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 8px 0 4px;
      }

      #${MODAL_ID} .acbu-preset,
      #${MODAL_ID} .acbu-button {
        border: 0;
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
      }

      #${MODAL_ID} .acbu-preset {
        background: #33353d;
        color: #f7f7f8;
        padding: 6px 9px;
        font-size: 12px;
      }

      #${MODAL_ID} .acbu-preset:hover {
        background: #454852;
      }

      #${MODAL_ID} .acbu-help,
      #${MODAL_ID} .acbu-count {
        color: #bdbdc6;
        font-size: 12px;
      }

      #${MODAL_ID} .acbu-question {
        margin-top: 14px;
        color: #f0f0f3;
        font-size: 14px;
        line-height: 1.5;
      }

      #${MODAL_ID} .acbu-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      #${MODAL_ID} .acbu-error {
        min-height: 18px;
        margin-top: 8px;
        color: #ff9cae;
        font-size: 12px;
      }

      #${MODAL_ID} .acbu-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      #${MODAL_ID} .acbu-button {
        min-width: 72px;
        padding: 8px 12px;
      }

      #${MODAL_ID} .acbu-cancel {
        background: #3a3c45;
        color: #f5f5f7;
      }

      #${MODAL_ID} .acbu-submit {
        background: #e83f5f;
        color: #ffffff;
        font-weight: 700;
      }

      #${MODAL_ID} .acbu-submit:disabled {
        cursor: default;
        opacity: 0.55;
      }

      #${MANAGER_ID} {
        position: fixed;
        left: 6px;
        bottom: 8px;
        z-index: 2147483000;
        width: 205px;
        box-sizing: border-box;
        border-radius: 8px;
        background: rgba(32, 33, 38, 0.75);
        color: #f0f0f3;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
        overflow: hidden;
        transition: opacity 180ms ease, transform 180ms ease;
      }

      #${MANAGER_ID}.collapsed {
        width: 205px;
      }

      #${MANAGER_ID} .acbm-body {
        padding: 10px 14px 8px;
        max-height: 360px;
        opacity: 1;
        overflow: hidden;
        transition: max-height 220ms ease, opacity 180ms ease, padding 220ms ease;
      }

      #${MANAGER_ID}.collapsed .acbm-body {
        max-height: 0;
        opacity: 0;
        padding-top: 0;
        padding-bottom: 0;
      }

      #${MANAGER_ID} .acbm-title {
        font-weight: 800;
        line-height: 1.25;
        margin-bottom: 8px;
      }

      #${MANAGER_ID} .acbm-row {
        border-top: 1px solid rgba(255, 255, 255, 0.65);
        padding: 7px 0;
      }

      #${MANAGER_ID} button {
        border: 0;
        background: transparent;
        color: #f0f0f3;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }

      #${MANAGER_ID} .acbm-count {
        float: right;
        min-width: 28px;
        border-radius: 5px;
        background: #d8d8dd;
        color: #202126;
        text-align: center;
        padding: 2px 5px;
      }

      #${MANAGER_ID} .acbm-login input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.4);
        border-radius: 5px;
        background: #14151a;
        color: #fff;
        margin: 4px 0;
        padding: 6px;
      }

      #${MANAGER_ID} .acbm-footer {
        border-top: 1px solid rgba(255, 255, 255, 0.65);
        color: #d8d8dd;
        padding-top: 7px;
      }

      #${MANAGER_ID} .acbm-toggle {
        width: 100%;
        height: 38px;
        border-top: 1px solid rgba(255, 255, 255, 0.65);
        font-size: 26px;
        line-height: 1;
      }

      #${MODAL_ID} .acbu-wide {
        width: min(740px, calc(100vw - 36px));
        max-height: min(720px, calc(100vh - 40px));
      }

      #${MODAL_ID} .acbu-list {
        max-height: 520px;
        overflow: auto;
        padding: 10px 0;
      }

      #${MODAL_ID} .acbu-item {
        border: 1px solid rgba(255, 255, 255, 0.55);
        border-radius: 8px;
        margin: 10px 0;
        padding: 12px 14px;
      }

      #${MODAL_ID} .acbu-item button,
      #${MODAL_ID} .acbu-search button {
        border: 0;
        border-radius: 14px;
        background: #d8d8dd;
        color: #202126;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        margin: 6px 6px 0 0;
        padding: 6px 12px;
      }

      #${MODAL_ID} .acbu-search {
        display: flex;
        gap: 8px;
        margin: 10px 0;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.remove();
  }

  function chooseDirectInput(select) {
    const option = findDirectInputOption(select);
    if (!option) {
      throw new Error('원본 사이트의 직접입력 옵션을 찾지 못했습니다.');
    }

    option.selected = true;
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function withPromptAnswers(duration, reason, action) {
    const originalPrompt = window.prompt;
    let usedDuration = false;
    let usedReason = false;
    let restored = false;

    function restore() {
      if (restored) return;
      restored = true;
      clearTimeout(timer);
      window.prompt = originalPrompt;
    }

    const timer = window.setTimeout(restore, 8000);

    window.prompt = function (message, defaultValue) {
      const text = String(message || '');

      if (!usedDuration && /기간|일단위|365일/.test(text)) {
        usedDuration = true;
        if (usedReason) restore();
        return duration;
      }

      if (!usedReason && /사유/.test(text)) {
        usedReason = true;
        if (usedDuration) restore();
        return reason;
      }

      return originalPrompt.call(this, message, defaultValue);
    };

    try {
      action();
    } catch (error) {
      restore();
      throw error;
    }
  }

  function withConfirmAnswer(answer, action) {
    const originalConfirm = window.confirm;
    let restored = false;

    function restore() {
      if (restored) return;
      restored = true;
      clearTimeout(timer);
      window.confirm = originalConfirm;
    }

    const timer = window.setTimeout(restore, 8000);

    window.confirm = function () {
      restore();
      return answer;
    };

    try {
      action();
    } catch (error) {
      restore();
      throw error;
    }
  }

  function openUnblockModal(context) {
    injectStyle();
    closeModal();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;

    const dialog = document.createElement('div');
    dialog.className = 'acbu-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'acbu-head';

    const title = document.createElement('div');
    title.className = 'acbu-title';
    title.textContent = '차단 해제';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'acbu-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeModal);

    head.append(title, close);

    const body = document.createElement('div');
    body.className = 'acbu-body';

    const target = document.createElement('div');
    target.className = 'acbu-target';
    target.textContent = context.targetLabel ? `대상: ${context.targetLabel}` : '대상 정보를 불러오지 못했습니다.';
    body.appendChild(target);

    if (context.targetUrl) {
      const targetUrl = document.createElement('div');
      targetUrl.className = 'acbu-target acbu-url';
      targetUrl.textContent = `차단 당시 URL: ${context.targetUrl}`;
      body.appendChild(targetUrl);
    }

    const question = document.createElement('div');
    question.className = 'acbu-question';
    question.textContent = '차단을 해제하시곘습니까?';
    body.appendChild(question);

    const error = document.createElement('div');
    error.className = 'acbu-error';
    body.appendChild(error);

    const actions = document.createElement('div');
    actions.className = 'acbu-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'acbu-button acbu-cancel';
    cancel.textContent = '취소';
    cancel.addEventListener('click', closeModal);

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'acbu-button acbu-submit';
    submit.textContent = '해제';
    submit.addEventListener('click', () => {
      submit.disabled = true;
      error.textContent = '';

      try {
        recordUnblockLog(context);
        withConfirmAnswer(true, () => {
          context.sourceButton.click();
        });
        closeModal();
      } catch (err) {
        submit.disabled = false;
        error.textContent = err && err.message ? err.message : '차단 해제 실행 중 오류가 발생했습니다.';
      }
    });

    actions.append(cancel, submit);
    dialog.append(head, body, actions);
    overlay.appendChild(dialog);
    document.documentElement.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal();
    });

    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit.click();
    });

    submit.focus();
  }

  function openBlockModal(context) {
    injectStyle();
    closeModal();

    const presetsConfig = context.presets || BOARD_PRESETS;
    const defaultDuration = context.defaultDuration || localStorage.getItem(LAST_DURATION_KEY) || '7';
    const rememberDuration = context.rememberDuration !== false;

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;

    const dialog = document.createElement('div');
    dialog.className = 'acbu-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'acbu-head';

    const title = document.createElement('div');
    title.className = 'acbu-title';
    title.textContent = context.title || '차단 설정';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'acbu-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeModal);

    head.append(title, close);

    const body = document.createElement('div');
    body.className = 'acbu-body';

    const target = document.createElement('div');
    target.className = 'acbu-target';
    target.textContent = context.targetLabel ? `${context.targetPrefix || '차단 대상'}: ${context.targetLabel}` : '차단 대상 정보를 읽지 못했습니다.';

    const targetUrl = document.createElement('div');
    targetUrl.className = 'acbu-target acbu-url';
    targetUrl.textContent = context.targetUrl ? `URL: ${context.targetUrl}` : '';

    const durationLabel = document.createElement('label');
    durationLabel.textContent = context.durationLabel || '차단 기간';

    const durationInput = document.createElement('input');
    durationInput.type = 'text';
    durationInput.value = defaultDuration;
    durationInput.placeholder = context.durationPlaceholder || '예: 7, 30, 1*0.5';
    let refreshReasonPlaceholder = () => {};
    durationInput.addEventListener('input', () => refreshReasonPlaceholder());

    const presets = document.createElement('div');
    presets.className = 'acbu-presets';
    for (const [label, value] of presetsConfig) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'acbu-preset';
      button.textContent = label;
      button.addEventListener('click', () => {
        durationInput.value = value;
        refreshReasonPlaceholder();
        durationInput.focus();
      });
      presets.appendChild(button);
    }

    const help = document.createElement('div');
    help.className = 'acbu-help';
    help.textContent = context.helpText || '일 단위로 입력합니다. 예시) 12시간은 [1*0.5]';

    const reasonRow = document.createElement('div');
    reasonRow.className = 'acbu-row';

    const reasonLabel = document.createElement('label');
    reasonLabel.textContent = '차단 사유';

    const count = document.createElement('div');
    count.className = 'acbu-count';
    count.textContent = '0/128';

    reasonRow.append(reasonLabel, count);

    const reasonInput = document.createElement('textarea');
    reasonInput.maxLength = 128;
    reasonInput.value = context.defaultReasonValue || '';
    refreshReasonPlaceholder = () => {
      if (context.getReasonPlaceholder) {
        reasonInput.placeholder = context.getReasonPlaceholder(durationInput.value.trim());
      } else {
        reasonInput.placeholder = context.reasonPlaceholder || '차단 사유는 비워두어도 됩니다.';
      }
    };
    refreshReasonPlaceholder();
    reasonInput.addEventListener('input', () => {
      count.textContent = `${reasonInput.value.length}/128`;
    });
    count.textContent = `${reasonInput.value.length}/128`;

    const error = document.createElement('div');
    error.className = 'acbu-error';

    const headerFields = context.targetUrl ? [target, targetUrl] : [target];
    body.append(...headerFields, durationLabel, durationInput, presets, help, reasonRow, reasonInput, error);

    const actions = document.createElement('div');
    actions.className = 'acbu-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'acbu-button acbu-cancel';
    cancel.textContent = '취소';
    cancel.addEventListener('click', closeModal);

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'acbu-button acbu-submit';
    submit.textContent = '차단';

    submit.addEventListener('click', async () => {
      const duration = durationInput.value.trim();
      const reason = reasonInput.value.trim();

      if (!duration) {
        error.textContent = '차단 기간을 입력해주세요.';
        durationInput.focus();
        return;
      }

      if (context.validateDuration) {
        const message = context.validateDuration(duration);
        if (message) {
          error.textContent = message;
          durationInput.focus();
          return;
        }
      }

      if (reason.length > 128) {
        error.textContent = '차단 사유는 128자 이하여야 합니다.';
        reasonInput.focus();
        return;
      }

      submit.disabled = true;
      error.textContent = '';

      try {
        if (rememberDuration) localStorage.setItem(LAST_DURATION_KEY, duration);
        const recordReason = reason || (context.getFallbackReason ? context.getFallbackReason(duration) : '');
        recordBlockLog(context, duration, recordReason);

        if (context.onSubmit) {
          await context.onSubmit({ duration, reason });
        } else {
          withPromptAnswers(duration, reason, () => {
            chooseDirectInput(context.select);
            context.sourceButton.click();
          });
        }

        closeModal();
      } catch (err) {
        submit.disabled = false;
        error.textContent = err && err.message ? err.message : '차단 실행 중 오류가 발생했습니다.';
      }
    });

    actions.append(cancel, submit);
    dialog.append(head, body, actions);
    overlay.appendChild(dialog);
    document.documentElement.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal();
    });

    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit.click();
    });

    durationInput.focus();
    durationInput.select();
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isSupabaseConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  function getStoredSession() {
    try {
      return JSON.parse(localStorage.getItem(SUPABASE_SESSION_KEY) || 'null');
    } catch (_error) {
      return null;
    }
  }

  function setStoredSession(session) {
    localStorage.setItem(SUPABASE_SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(SUPABASE_ADMIN_KEY, session.admin_nickname || '');
  }

  function getCurrentAdminName() {
    const stored = localStorage.getItem(SUPABASE_ADMIN_KEY);

    const candidates = Array.from(document.querySelectorAll('a, span, button, div'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = normalizeText(el.textContent).replace(/[^A-Za-z0-9가-힣_#.-]/g, '');
        return { rect, text };
      })
      .filter(({ rect, text }) => {
        if (!text || text.length < 2 || text.length > 20) return false;
        if (rect.top > 58 || rect.right < window.innerWidth * 0.68) return false;
        if (/알림|구독|찾기|채널|로그인|설정/.test(text)) return false;
        return /^[A-Za-z0-9가-힣_#.-]+$/.test(text);
      })
      .sort((a, b) => {
        const areaA = Math.max(1, a.rect.width * a.rect.height);
        const areaB = Math.max(1, b.rect.width * b.rect.height);
        return areaA - areaB || b.rect.right - a.rect.right;
      });

    return candidates[0]?.text || stored || 'unknown';
  }

  async function refreshSupabaseSession(session) {
    if (!session?.refresh_token) return session;
    if (session.expires_at && session.expires_at * 1000 > Date.now() + 60000) return session;

    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });

    if (!response.ok) {
      localStorage.removeItem(SUPABASE_SESSION_KEY);
      throw new Error('SB 세션 갱신 실패');
    }

    const data = await response.json();
    const refreshed = {
      ...session,
      access_token: data.access_token,
      refresh_token: data.refresh_token || session.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    };
    setStoredSession(refreshed);
    return refreshed;
  }

  async function supabaseRpc(name, payload = {}, keepalive = false) {
    if (!isSupabaseConfigured()) {
      throw new Error('SB URL/ANON key를 스크립트 상단에 입력해주세요.');
    }

    const session = await refreshSupabaseSession(getStoredSession());
    const accessToken = session?.access_token || SUPABASE_ANON_KEY;

    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `SB RPC 실패: ${name}`);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function loginSupabase(password) {
    if (!isSupabaseConfigured()) {
      throw new Error('SB URL/ANON key를 스크립트 상단에 입력해주세요.');
    }

    const adminName = getCurrentAdminName();
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: SUPABASE_LOGIN_EMAIL,
        password,
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || 'SB Auth 로그인 실패');
    }

    const data = await response.json();
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      admin_nickname: adminName,
    };
    setStoredSession(session);
    await supabaseRpc('gfl2_set_admin_nickname', { p_admin_nickname: adminName });
    return session;
  }

  function parseDurationDays(value) {
    const parsed = parseDayExpression(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function recordBlockLog(context, duration, reason) {
    const session = getStoredSession();
    if (!session || !session.access_token || !isSupabaseConfigured()) return;

    const durationDays = parseDurationDays(duration);
    if (!durationDays) return;

    void supabaseRpc('gfl2_record_block', {
      p_target_username: context.targetLabel || '',
      p_profile_url: context.targetProfileUrl || null,
      p_post_url: context.targetUrl || location.href,
      p_duration_days: durationDays,
      p_reason: reason || '',
      p_source: PAGE_MODE,
    }, true).catch(() => {});
  }

  function recordUnblockLog(context) {
    const session = getStoredSession();
    if (!session || !session.access_token || !isSupabaseConfigured()) return;

    void supabaseRpc('gfl2_record_unblock', {
      p_target_username: context.targetLabel || '',
      p_post_url: context.targetUrl || null,
      p_source: PAGE_MODE,
    }, true).catch(() => {});
  }

  function openManagerModal(titleText, renderBody) {
    injectStyle();
    closeModal();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;

    const dialog = document.createElement('div');
    dialog.className = 'acbu-dialog acbu-wide';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'acbu-head';

    const title = document.createElement('div');
    title.className = 'acbu-title';
    title.textContent = titleText;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'acbu-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeModal);

    head.append(title, close);

    const body = document.createElement('div');
    body.className = 'acbu-body';
    renderBody(body);

    dialog.append(head, body);
    overlay.appendChild(dialog);
    document.documentElement.appendChild(overlay);
  }

  function addText(parent, text, className = '') {
    const div = document.createElement('div');
    if (className) div.className = className;
    div.textContent = text;
    parent.appendChild(div);
    return div;
  }

  function addLinkButton(parent, text, url) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.disabled = !url;
    button.addEventListener('click', () => {
      if (url) window.open(url, '_blank', 'noopener');
    });
    parent.appendChild(button);
  }

  function formatDisplayTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const pad = (number) => String(number).padStart(2, '0');
    return [
      shifted.getUTCFullYear(),
      pad(shifted.getUTCMonth() + 1),
      pad(shifted.getUTCDate()),
    ].join('-') + ' ' + [
      pad(shifted.getUTCHours()),
      pad(shifted.getUTCMinutes()),
      pad(shifted.getUTCSeconds()),
    ].join(':');
  }

  async function openExpiringList() {
    const session = getStoredSession();
    openManagerModal('갱차 갱신 필요 | 확인', (body) => {
      const list = addText(body, '불러오는 중...', 'acbu-list');

      supabaseRpc('gfl2_expiring_blocks')
        .then((rows) => {
          list.textContent = '';
          const data = Array.isArray(rows) ? rows : [];
          if (!data.length) {
            list.textContent = '표시할 대상이 없습니다.';
            return;
          }

          for (const row of data) {
            const item = document.createElement('div');
            item.className = 'acbu-item';
            addText(item, `대상: ${row.target_username || ''}`);
            addText(item, `만료: [${row.days_left ?? ''}일] 남았습니다.`);
            addText(item, `사유: ${row.block_reason || ''}`);
            addLinkButton(item, '대상의 프로필', row.target_profile_url);
            addLinkButton(item, '차단된 게시글', row.blocked_post_url);
            list.appendChild(item);
          }
        })
        .catch((err) => {
          list.textContent = err.message || '조회 실패';
        });
    });
  }

  function openBlockSearch() {
    const session = getStoredSession();
    openManagerModal('차단 누적 검색', (body) => {
      const search = document.createElement('div');
      search.className = 'acbu-search';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '닉네임';

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '검색';

      const result = document.createElement('div');
      result.className = 'acbu-list';

      button.addEventListener('click', () => {
        result.textContent = '검색 중...';
        supabaseRpc('gfl2_search_user_blocks', {
          p_query: input.value.trim(),
        }).then((rows) => {
          result.textContent = '';
          const data = Array.isArray(rows) ? rows : [];
          if (!data.length) {
            result.textContent = '검색 결과가 없습니다.';
            return;
          }

          for (const row of data) {
            const item = document.createElement('div');
            item.className = 'acbu-item';
            addText(item, `대상: ${row.target_username}`);
            addText(item, `누적: ${row.block_count}회`);
            addLinkButton(item, '대상의 프로필', row.target_profile_url);
            result.appendChild(item);
          }
        }).catch((err) => {
          result.textContent = err.message || '검색 실패';
        });
      });

      search.append(input, button);
      body.append(search, result);
      input.focus();
    });
  }

  function openActionHistory() {
    const session = getStoredSession();
    openManagerModal('관리 내역 보기', (body) => {
      const list = addText(body, '불러오는 중...', 'acbu-list');
      supabaseRpc('gfl2_recent_actions')
        .then((rows) => {
          list.textContent = '';
          const data = Array.isArray(rows) ? rows : [];
          if (!data.length) {
            list.textContent = '관리 내역이 없습니다.';
            return;
          }

          for (const row of data) {
            const item = document.createElement('div');
            item.className = 'acbu-item';
            addText(item, `행동: ${row.action_type === 'unblock' ? '차단 해제' : '차단'}`);
            addText(item, `대상: ${row.target_username || ''}`);
            addText(item, `처리자: ${row.admin_nickname || ''}`);
            addText(item, `기록일: ${formatDisplayTime(row.recorded_at)}`);
            list.appendChild(item);
          }
        })
        .catch((err) => {
          list.textContent = err.message || '조회 실패';
        });
    });
  }

  function initManagerPanel() {
    injectStyle();
    if (document.getElementById(MANAGER_ID)) return;

    const panel = document.createElement('div');
    panel.id = MANAGER_ID;

    const body = document.createElement('div');
    body.className = 'acbm-body';

    const title = document.createElement('div');
    title.className = 'acbm-title';
    title.textContent = '솦챈 굴라그 키퍼 v0.4.2';

    const status = document.createElement('div');
    status.className = 'acbm-row';

    const rowExpiring = document.createElement('div');
    rowExpiring.className = 'acbm-row';
    const expiringButton = document.createElement('button');
    expiringButton.type = 'button';
    expiringButton.textContent = '갱차 갱신 필요';
    const count = document.createElement('span');
    count.className = 'acbm-count';
    count.textContent = '0';
    rowExpiring.append(expiringButton, count);

    const rowSearch = document.createElement('div');
    rowSearch.className = 'acbm-row';
    const searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.textContent = '차단 누적 검색 🔍';
    rowSearch.appendChild(searchButton);

    const rowHistory = document.createElement('div');
    rowHistory.className = 'acbm-row';
    const historyButton = document.createElement('button');
    historyButton.type = 'button';
    historyButton.textContent = '관리 내역 보기';
    rowHistory.appendChild(historyButton);

    const footer = document.createElement('div');
    footer.className = 'acbm-footer';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'acbm-toggle';
    toggle.textContent = '⌄';

    function refreshCount() {
      const session = getStoredSession();
      if (!session || !session.access_token || !isSupabaseConfigured()) return;

      supabaseRpc('gfl2_expiring_count')
        .then((value) => {
          count.textContent = String(Array.isArray(value) ? value[0] : value ?? 0);
        })
        .catch(() => {});
    }

    function renderLoggedIn(session) {
      status.textContent = '';
      const adminName = getCurrentAdminName();
      const nextSession = { ...session, admin_nickname: adminName };
      setStoredSession(nextSession);
      footer.textContent = `처리자: ${adminName}`;
      if (isSupabaseConfigured()) {
        void supabaseRpc('gfl2_set_admin_nickname', { p_admin_nickname: adminName }).catch(() => {});
      }
      refreshCount();
    }

    function renderLogin() {
      status.textContent = '';

      if (!isSupabaseConfigured()) {
        status.textContent = 'SB 설정 필요';
        footer.textContent = `처리자: ${getCurrentAdminName()}`;
        return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'acbm-login';
      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = '공용 비밀번호를 입력하세요.';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '로그인하기 (Click)';
      button.addEventListener('click', () => {
        button.disabled = true;
        loginSupabase(input.value)
          .then(renderLoggedIn)
          .catch((err) => {
            button.disabled = false;
            status.textContent = err.message || '로그인 실패';
          });
      });
      wrap.append(input, button);
      status.appendChild(wrap);
      footer.textContent = `처리자: ${getCurrentAdminName()}`;
    }

    const session = getStoredSession();
    if (session && session.access_token) renderLoggedIn(session);
    else renderLogin();

    expiringButton.addEventListener('click', () => {
      if (getStoredSession()) openExpiringList();
    });
    searchButton.addEventListener('click', () => {
      if (getStoredSession()) openBlockSearch();
    });
    historyButton.addEventListener('click', () => {
      if (getStoredSession()) openActionHistory();
    });
    toggle.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      toggle.textContent = panel.classList.contains('collapsed') ? '⌃' : '⌄';
    });

    body.append(title, status, rowExpiring, rowSearch, rowHistory, footer);
    panel.append(body, toggle);
    document.documentElement.appendChild(panel);
  }

  function parseReportDurationHours(text) {
    const compact = compactText(text);
    const found = REPORT_DURATION_OPTIONS.find((option) => {
      return option.match ? option.match.test(compact) : compact.includes(option.label);
    });
    return found ? String(found.hours) : '';
  }

  function parseReportDurationDays(text) {
    const compact = compactText(text);
    const found = REPORT_DURATION_OPTIONS.find((option) => {
      return option.match ? option.match.test(compact) : compact.includes(option.label);
    });
    return found ? found.days : '';
  }

  function parseDayExpression(value) {
    const text = String(value || '').replace(/\s+/g, '').trim();
    if (!text) return NaN;

    if (/^\d+(?:\.\d+)?$/.test(text)) {
      return Number(text);
    }

    if (/^\d+(?:\.\d+)?(?:\*\d+(?:\.\d+)?)+$/.test(text)) {
      return text.split('*').reduce((total, part) => total * Number(part), 1);
    }

    return NaN;
  }

  function reportDurationDaysToHours(duration) {
    const days = parseDayExpression(duration);
    if (!Number.isFinite(days)) return NaN;
    return Math.round(days * 24 * 1000) / 1000;
  }

  function validateReportDuration(duration) {
    const hours = reportDurationDaysToHours(duration);
    const allowed = REPORT_DURATION_OPTIONS.some((option) => option.hours === hours);

    if (!Number.isFinite(hours) || !allowed) {
      return '신고 처리 페이지에서는 1*0.25, 1, 3, 7, 30, 365 중 하나를 선택해주세요.';
    }

    return '';
  }

  function findReportFieldValue(labelText) {
    for (const row of document.querySelectorAll('tr')) {
      const cells = Array.from(row.children);
      if (cells.length < 2) continue;

      const label = compactText(cells[0].textContent);
      if (label.includes(compactText(labelText))) {
        return cleanTargetLabel(cells[1].textContent).slice(0, 80);
      }
    }

    return '';
  }

  function findReportTargetUrl() {
    for (const row of document.querySelectorAll('tr')) {
      const cells = Array.from(row.children);
      if (cells.length < 2) continue;

      const label = compactText(cells[0].textContent);
      if (!label.includes('대상')) continue;

      const link = cells[1].querySelector('a[href]');
      if (!link) return '';

      try {
        return new URL(link.getAttribute('href'), location.href).href;
      } catch (_error) {
        return link.getAttribute('href') || '';
      }
    }

    return '';
  }

  function findReportProfileUrl() {
    for (const row of document.querySelectorAll('tr')) {
      const cells = Array.from(row.children);
      if (cells.length < 2) continue;

      const label = compactText(cells[0].textContent);
      if (!label.includes('작성자명')) continue;

      const link = cells[1].querySelector('a[href]');
      return link ? absoluteUrl(link.getAttribute('href')) : '';
    }

    return '';
  }

  function findReportTargetLabel() {
    return findReportFieldValue('작성자명') || findReportFieldValue('대상') || '';
  }

  function isReportActionButton(el) {
    if (!el || el.dataset[MARK_SOURCE] || el.dataset[MARK_FAKE]) return false;
    if (el.closest(`#${MODAL_ID}`)) return false;

    const text = getControlText(el);
    if (!text || REPORT_IGNORED_ACTIONS.has(text)) return false;

    return Boolean(parseReportDurationHours(text));
  }

  function isReportActionButtonCandidate(el) {
    if (!el || el.closest(`#${MODAL_ID}`)) return false;
    if (getControlText(el) === '전송') return false;
    return Boolean(parseReportDurationHours(getControlText(el)));
  }

  function findReportActionButtonForDuration(duration) {
    const target = reportDurationDaysToHours(duration);
    if (!Number.isFinite(target)) return null;

    const candidates = document.querySelectorAll('button, input[type="button"], input[type="submit"], a');

    for (const candidate of candidates) {
      if (!isReportActionButtonCandidate(candidate)) continue;

      if (Number(parseReportDurationHours(getControlText(candidate))) === target) {
        return candidate;
      }
    }

    return null;
  }

  function findReportReasonInput() {
    const byPlaceholder = document.querySelector('input[placeholder*="차단 사유"], textarea[placeholder*="차단 사유"]');
    if (byPlaceholder) return byPlaceholder;

    const fields = Array.from(document.querySelectorAll('input[type="text"], textarea'));
    for (const field of fields) {
      const row = field.closest('tr');
      if (row && compactText(row.textContent).includes('차단사유')) return field;
    }

    return null;
  }

  function setInputValue(field, value) {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findReportSendButton() {
    const candidates = document.querySelectorAll('button, input[type="button"], input[type="submit"], a');

    for (const candidate of candidates) {
      if (getControlText(candidate) === '전송') return candidate;
    }

    return null;
  }

  async function submitReportBlockAction(context, values) {
    const durationButton = findReportActionButtonForDuration(values.duration);
    if (!durationButton) {
      throw new Error('선택한 기간에 해당하는 원본 조치 버튼을 찾지 못했습니다.');
    }

    const fallbackReason = getControlText(durationButton) || context.actionText;
    const reason = values.reason || fallbackReason;

    bypassReportActionButtons.add(durationButton);
    durationButton.click();
    await wait(80);

    const reasonInput = findReportReasonInput();
    if (!reasonInput) {
      throw new Error('차단 사유 입력칸을 찾지 못했습니다.');
    }

    setInputValue(reasonInput, reason);

    const sendButton = findReportSendButton();
    if (!sendButton) {
      throw new Error('전송 버튼을 찾지 못했습니다.');
    }

    sendButton.click();
  }

  function processReportActionButton(button) {
    const actionText = getControlText(button);
    const duration = parseReportDurationDays(actionText);
    if (!duration) return;

    button.dataset[MARK_SOURCE] = 'report';
    button.addEventListener('click', (event) => {
      if (bypassReportActionButtons.has(button)) {
        bypassReportActionButtons.delete(button);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openBlockModal({
        title: '신고 차단 설정',
        targetPrefix: '작성자',
        targetLabel: findReportTargetLabel(),
        targetUrl: findReportTargetUrl(),
        targetProfileUrl: findReportProfileUrl(),
        durationLabel: '차단 기간(일)',
        durationPlaceholder: '예: 1, 3, 7, 30, 365',
        defaultDuration: duration,
        presets: REPORT_PRESETS,
        rememberDuration: false,
        helpText: '일 단위로 입력합니다. 6시간은 1*0.25 형식으로 보냅니다.',
        getFallbackReason: (selectedDuration) => {
          const durationButton = findReportActionButtonForDuration(selectedDuration);
          return durationButton ? getControlText(durationButton) : actionText;
        },
        getReasonPlaceholder: (selectedDuration) => {
          const durationButton = findReportActionButtonForDuration(selectedDuration);
          const fallbackReason = durationButton ? getControlText(durationButton) : actionText;
          return `비워두면 "${fallbackReason}"를 차단 사유로 보냅니다.`;
        },
        validateDuration: validateReportDuration,
        onSubmit: (values) => submitReportBlockAction({ sourceButton: button, actionText }, values),
      });
    }, true);
  }

  function cleanUsernameLabel(value) {
    return cleanTargetLabel(value)
      .replace(/[✓✔●]+$/g, '')
      .trim();
  }

  function isBoardUnblockButton(el) {
    if (!el || el.dataset[MARK_SOURCE] || el.dataset[MARK_FAKE]) return false;
    if (el.closest(`#${MODAL_ID}`)) return false;
    return getControlText(el) === '차단 해제';
  }

  function isBlockedListUnblockButton(el) {
    if (!el || el.dataset[MARK_SOURCE] || el.dataset[MARK_FAKE]) return false;
    if (el.closest(`#${MODAL_ID}`)) return false;
    return getControlText(el) === '해제';
  }

  function findControlRoot(button) {
    return button.closest('.info-row, .comment-info, .article-head, .comment-wrapper, .comment-item, .reply-item') || button.parentElement;
  }

  function findBoardUnblockTargetLabel(button) {
    const root = findControlRoot(button);
    if (!root) return '';

    const links = Array.from(root.querySelectorAll('a')).filter((link) => {
      const text = cleanUsernameLabel(link.textContent);
      if (!text) return false;
      return Boolean(link.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
    });

    if (links.length) {
      return cleanUsernameLabel(links[links.length - 1].textContent).slice(0, 80);
    }

    const beforeButton = normalizeText(root.textContent).split(getControlText(button))[0] || '';
    return cleanUsernameLabel(beforeButton.replace(/\b20\d{2}-\d{2}-\d{2}.*$/u, '')).slice(0, 80);
  }

  function findBlockedListItem(button) {
    const direct = button.closest('tr, li, .blocked-item, .list-item, .item, .row');
    if (direct && /게시글\s*\d+|댓글\s*\d+/.test(direct.textContent || '')) return direct;

    let node = button.parentElement;
    while (node && node !== document.body) {
      const text = node.textContent || '';
      if (/게시글\s*\d+|댓글\s*\d+/.test(text) && text.includes('해제')) return node;
      node = node.parentElement;
    }

    return button.parentElement;
  }

  function findBlockedListVisualLines(button) {
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
      .filter((el) => getControlText(el) === '해제' && !el.closest(`#${MODAL_ID}`) && el.getBoundingClientRect().height)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const rowIndex = buttons.indexOf(button);
    if (rowIndex < 0) return [];

    const rows = [];
    let bucket = [];
    const lines = (document.body.innerText || '').split(/\n+/).map((line) => normalizeText(line)).filter(Boolean);

    for (const line of lines) {
      if (line === '해제') {
        const clean = bucket.filter((value) => !/^\d{1,2}:\d{2}\s*~|^\d{2}-\d{2}\s*~|~\s*\d{2}-\d{2}/.test(value));
        const tail = clean.slice(-3);
        const linkLine = tail.find((value) => /게시글\s*\d+|댓글\s*\d+/.test(value)) || tail[1] || '';
        const linkIndex = Math.max(1, tail.indexOf(linkLine));
        rows.push([tail[linkIndex - 1] || tail[0] || '', linkLine]);
        bucket = [];
      } else {
        bucket.push(line);
      }
    }

    return rows[rowIndex] || [];
  }

  function findBlockedListVisualLink(button, secondLine) {
    const buttonRect = button.getBoundingClientRect();
    const links = [];

    for (const link of document.querySelectorAll('a[href]')) {
      if (link.closest(`#${MODAL_ID}`)) continue;

      const rect = link.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (rect.left > buttonRect.left - 40) continue;
      if (Math.abs(rect.top - buttonRect.top) > 90) continue;

      const text = normalizeText(link.textContent);
      const href = link.getAttribute('href') || '';

      if (/게시글\s*\d+|댓글\s*\d+/.test(text) || /\/b\/gilrsfrontline2exili\/\d+/.test(href) || (secondLine && secondLine.includes(text))) {
        links.push({
          href,
          score: Math.abs(rect.top - buttonRect.top) + rect.left,
        });
      }
    }

    links.sort((a, b) => a.score - b.score);
    return links.length ? absoluteUrl(links[0].href) : '';
  }

  function findBlockedListTargetLabel(button) {
    const visualLines = findBlockedListVisualLines(button);
    if (visualLines[0]) return cleanUsernameLabel(visualLines[0]).slice(0, 80);

    const item = findBlockedListItem(button);
    if (!item) return '';

    const text = item.innerText || item.textContent || '';
    const lines = text.split(/\n+/).map((line) => cleanUsernameLabel(line)).filter(Boolean);

    for (const line of lines) {
      if (line === '해제') continue;
      if (/게시글\s*\d+|댓글\s*\d+/.test(line)) continue;
      if (/^\d{1,2}:\d{2}|^\d{2}-\d{2}|~/.test(line)) continue;
      if (line.includes('차단') || line.includes('알림') || line.includes('구독')) continue;
      return line.slice(0, 80);
    }

    return '';
  }

  function absoluteUrl(href) {
    if (!href) return '';

    try {
      return new URL(href, location.href).href;
    } catch (_error) {
      return href;
    }
  }

  function findBlockedListTargetUrl(button) {
    const visualLines = findBlockedListVisualLines(button);
    const visualLink = findBlockedListVisualLink(button, visualLines[1] || '');
    if (visualLink) return visualLink;

    const visualMatch = (visualLines[1] || '').match(/게시글\s*(\d+)/);
    if (visualMatch) return `${BOARD_PREFIX}/${visualMatch[1]}`;

    const item = findBlockedListItem(button);
    if (!item) return '';

    for (const link of item.querySelectorAll('a[href]')) {
      const text = normalizeText(link.textContent);
      const href = link.getAttribute('href') || '';

      if (/게시글\s*\d+|댓글\s*\d+/.test(text) || /\/b\/gilrsfrontline2exili\/\d+/.test(href)) {
        return absoluteUrl(href);
      }
    }

    const match = (item.innerText || item.textContent || '').match(/게시글\s*(\d+)/);
    if (match) return `${BOARD_PREFIX}/${match[1]}`;

    return '';
  }

  function processUnblockButton(button, getContext) {
    injectStyle();

    const fake = createFakeBlockButton(button);
    fake.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openUnblockModal({
        sourceButton: button,
        ...getContext(fake),
      });
    }, true);

    button.dataset[MARK_SOURCE] = 'unblock';
    button.classList.add('arca-custom-block-ui-hidden-source');
    button.style.setProperty('display', 'none', 'important');
    button.after(fake);
  }

  function processBoardUnblockButton(button) {
    processUnblockButton(button, () => ({
      targetLabel: findBoardUnblockTargetLabel(button),
      targetUrl: location.href,
    }));
  }

  function processBlockedListUnblockButton(button) {
    processUnblockButton(button, (visibleButton) => ({
      targetLabel: findBlockedListTargetLabel(visibleButton),
      targetUrl: findBlockedListTargetUrl(visibleButton),
    }));
  }

  function createFakeBlockButton(sourceButton) {
    let fake;
    const label = getControlText(sourceButton) || '차단';

    if (sourceButton instanceof HTMLInputElement) {
      fake = document.createElement('input');
      fake.type = sourceButton.type === 'submit' ? 'button' : sourceButton.type || 'button';
      fake.value = label;
    } else if (sourceButton instanceof HTMLAnchorElement) {
      fake = document.createElement('a');
      fake.href = '#';
      fake.textContent = label;
    } else {
      fake = document.createElement('button');
      fake.type = 'button';
      fake.textContent = label;
    }

    fake.className = sourceButton.className;
    fake.style.cssText = sourceButton.style.cssText;
    fake.title = sourceButton.title || '';
    fake.dataset[MARK_FAKE] = '1';
    fake.removeAttribute('onclick');
    fake.setAttribute('aria-label', sourceButton.getAttribute('aria-label') || '차단');
    return fake;
  }

  function processBlockButton(button) {
    injectStyle();

    const select = findBlockSelect(button);
    if (!select) return;

    const fake = createFakeBlockButton(button);
    fake.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openBlockModal({
        sourceButton: button,
        select,
        targetLabel: findTargetLabel(button, select),
        targetUrl: location.href,
        targetProfileUrl: findTargetProfileUrl(button, select),
      });
    }, true);

    button.dataset[MARK_SOURCE] = '1';
    button.classList.add('arca-custom-block-ui-hidden-source');
    select.classList.add('arca-custom-block-ui-hidden-source');
    button.style.setProperty('display', 'none', 'important');
    select.style.setProperty('display', 'none', 'important');
    button.after(fake);
  }

  function sweep() {
    const candidates = document.querySelectorAll('button, input[type="button"], input[type="submit"], a');

    if (PAGE_MODE === 'report') {
      for (const el of candidates) {
        if (isReportActionButton(el)) processReportActionButton(el);
      }

      return;
    }

    if (PAGE_MODE === 'blocked') {
      for (const el of candidates) {
        if (isBlockedListUnblockButton(el)) processBlockedListUnblockButton(el);
      }

      return;
    }

    for (const el of candidates) {
      if (isBoardUnblockButton(el)) {
        processBoardUnblockButton(el);
        continue;
      }

      if (isBlockButton(el)) processBlockButton(el);
    }
  }

  function scheduleSweep() {
    if (scheduleSweep.pending) return;
    scheduleSweep.pending = true;
    window.setTimeout(() => {
      scheduleSweep.pending = false;
      sweep();
    }, 120);
  }

  sweep();

  const observer = new MutationObserver(scheduleSweep);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  initManagerPanel();
})();
