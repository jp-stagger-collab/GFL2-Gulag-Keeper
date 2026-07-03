// ==UserScript==
// @name         아카라이브 깡계확인 + 공용 채널 비율 (완전판)
// @namespace    http://kemomimi.com/
// @version      2.0.0
// @description  깡계 판별, 세탁챈 이용 여부, 글/댓글 기준 경고, 댓글만 유저, 현재 채널 활동 비율 (모든 채널 공용)
// @match        https://arca.live/b/*
// @grant        GM_xmlhttpRequest
// @connect      arca.live
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    /**********************
     * 현재 채널 ID
     **********************/
    const m = location.pathname.match(/^\/b\/([^\/]+)/);
    if (!m) return;
    const CURRENT_CHANNEL_ID = m[1];

    /**********************
     * 화이트리스트
     **********************/
    const getWhite = () => JSON.parse(GM_getValue("whlteArray", "[]"));
    const addWhite = v => {
        const a = getWhite();
        if (!a.includes(v)) GM_setValue("whlteArray", JSON.stringify([...a, v]));
    };
    const delWhite = v =>
        GM_setValue("whlteArray", JSON.stringify(getWhite().filter(x => x !== v)));

    /**********************
     * unsafe 링크 제거
     **********************/
    function removeUnsafe() {
        document.querySelectorAll('a[href*="unsafelink.com"]').forEach(a => {
            a.href = a.href.replace('https://unsafelink.com/', '');
            a.rel = 'external nofollow noopener noreferrer';
            a.target = '_blank';
        });
    }

    /**********************
     * 작성자 정보
     **********************/
    const firstLink = document.querySelector('.article-head .info-row .user-info a');
    const member = document.querySelector('.member-info');
    if (!firstLink || !member) return;

    const userKey = firstLink.dataset.filter;
    const white = getWhite();

    /**********************
     * 화이트리스트 버튼
     **********************/
    const btn = document.createElement('button');
    btn.textContent = white.includes(userKey) ? '➖' : '➕';
    btn.style.cursor = 'pointer';
    btn.style.background = 'transparent';
    btn.style.border = 'none';

    btn.onclick = () => {
        white.includes(userKey) ? delWhite(userKey) : addWhite(userKey);
        location.reload();
    };

    if (white.includes(userKey)) {
        member.appendChild(btn);
        return;
    }

    /**********************
     * 작성자 페이지 분석
     **********************/
    GM_xmlhttpRequest({
        method: 'GET',
        url: firstLink.href,
        onload(res) {
            removeUnsafe();

            const doc = new DOMParser().parseFromString(res.responseText, 'text/html');

            // 삭제된 계정
            if (doc.querySelector('.error-code')) {
                firstLink.style.cssText =
                    'color:red;font-weight:bold;text-decoration:line-through;font-size:14px';
                firstLink.textContent += ' (삭제된 계정)';
                member.appendChild(btn);
                return;
            }

            const card = doc.querySelector('.card-block');
            if (!card) return;

            const postSet = new Set();
            const commentSet = new Set();
            const channelSet = new Set();
            let washyourid = 0;

            card.querySelectorAll('.user-recent a').forEach(a => {
                const href = a.getAttribute('href');
                if (!href) return;

                const base = href.split('#')[0];

                if (href.includes('#')) commentSet.add(base);
                else postSet.add(base);

                const cm = base.match(/\/b\/([^\/]+)/);
                if (cm && cm[1] === CURRENT_CHANNEL_ID) {
                    channelSet.add(base);
                }

                const badge = a.querySelector('.badge');
                if (badge && badge.textContent.includes('세탁')) {
                    washyourid++;
                }
            });

            const post = postSet.size;
            const comment = commentSet.size;
            const total = post + comment;
            const channelActivity = channelSet.size;
            const ratio = total ? ((channelActivity / total) * 100).toFixed(0) : 0;

            /**********************
             * 표시 규칙 (원문 + 확장)
             **********************/

            // 댓글만 유저
            if (post === 0 && comment > 0) {
                firstLink.style.cssText =
                    'color:red;font-weight:bold;font-size:14px';
                firstLink.textContent += ` (댓글전용 계정 댓글:${comment})`;
            }
            // 최근 글/댓글 부족
            else if (post <= 5 || comment <= 5) {
                firstLink.style.cssText =
                    'color:red;font-weight:bold;font-size:14px';
                firstLink.textContent += ` (최근 글:${post} 댓글:${comment})`;
            }
            // 세탁챈 이용
            else if (washyourid >= 1) {
                firstLink.style.cssText =
                    'color:red;font-weight:bold;font-size:14px';
                firstLink.textContent +=
                    ` (세탁챈:${washyourid} 글:${post - washyourid})`;
            }
            // 정상 비율 표시
            else {
                if (ratio >= 80) firstLink.style.color = 'green';
                else if (ratio <= 20) firstLink.style.color = 'yellow';

                firstLink.style.fontSize = '14px';
                firstLink.textContent += ` (현재 채널 비율:${ratio}%)`;
            }

            member.appendChild(btn);
        }
    });
})();
