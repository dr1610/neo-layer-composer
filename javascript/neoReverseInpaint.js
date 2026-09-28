/* Neo Layer Composer 0.2.0: use Neo's native mask inversion without rewriting masks. */
(() => {
    'use strict';
    function repaintAlpha(alpha, inverted) { return (alpha > 128) !== inverted ? 105 : 0; }
    if (typeof module !== 'undefined' && module.exports) module.exports = {repaintAlpha};
    if (typeof document === 'undefined') return;
    function imageFrom(src) {
        return new Promise((resolve, reject) => {
            const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('画像を読み込めません。'));
            image.src = src;
        });
    }
    function maskRadios() { return [...document.querySelectorAll('#img2img_mask_mode input[type="radio"]')]; }
    function inverted() { const radios = maskRadios(); return radios.length === 2 ? radios[1].checked : null; }
    class ReversePanel {
        constructor(target, sketch) {
            this.target = target; this.sketch = sketch; this.revision = 0;
            this.root = document.createElement('details'); this.root.className = 'nlc-reverse';
            this.root.innerHTML = `<summary>逆インペイント・変更範囲の確認</summary><div class="nlc-reverse-body">
                <div class="nlc-reverse-buttons"><button type="button" data-mode="0">塗った部分を変更</button><button type="button" data-mode="1">塗った部分を保護（外側を変更）</button><button type="button" data-refresh>範囲を再表示</button></div>
                <p data-mode-label></p><p>赤い部分が描き直す範囲です。標準の「マスクモード」と連動します（両タブで共通）。</p>
                <p>境界のぼかし${sketch ? '・Sketchのマスク拡張' : ''}を加える前の概略です。保護領域のピクセル完全維持を保証する表示ではありません。</p>
                ${sketch ? '<p>Sketchでは塗った色も入力画像に含まれます。元の色のまま保護したい場合は通常のinpaintを使ってください。</p>' : ''}
                <canvas aria-label="赤色が変更対象の範囲プレビュー" hidden></canvas><p role="status" aria-live="polite"></p></div>`;
            // Keep the real ForgeCanvas first: Neo's resolution helper selects the first img/canvas.
            target.after(this.root);
            this.canvas = this.root.querySelector('canvas'); this.status = this.root.querySelector('[role="status"]');
            this.root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
                const radios = maskRadios(), index = Number(button.dataset.mode);
                if (radios.length !== 2) { this.status.textContent = '標準のマスクモードが見つかりません。Neoの対応状況を確認してください。'; return; }
                radios[index].click(); this.update(); this.refresh();
            }));
            this.root.querySelector('[data-refresh]').addEventListener('click', () => this.refresh());
            this.root.addEventListener('toggle', () => { if (this.root.open) { this.update(); this.refresh(); } });
            document.querySelector('#img2img_mask_mode')?.addEventListener('change', () => { this.update(); if (this.root.open) this.refresh(); });
            // Forge writes stroke changes to hidden Gradio textareas. Observe those input events.
            document.addEventListener('input', e => {
                const uuid = this.uuid();
                if (uuid && e.target.closest?.(`[id="${uuid}"]`)) {
                    clearTimeout(this.timer); this.revision++; this.canvas.hidden = true;
                    this.status.textContent = '変更範囲を更新しています…';
                    this.timer = setTimeout(() => { if (this.root.open) this.refresh(); }, 200);
                }
            });
            this.update();
        }
        uuid() { return this.target.querySelector('input[id^="imageInput_"]')?.id.slice('imageInput_'.length); }
        update() {
            const mode = inverted();
            this.root.querySelectorAll('[data-mode]').forEach(b => { b.disabled = mode === null; b.setAttribute('aria-pressed', String(mode !== null && Number(b.dataset.mode) === Number(mode))); });
            this.root.querySelector('[data-mode-label]').textContent = mode === null ? 'マスクモードを取得できません。' : mode ? '現在：塗った部分を保護し、外側を変更します。' : '現在：塗った部分を変更します。';
        }
        async refresh() {
            const ticket = ++this.revision; this.update(); this.canvas.hidden = true;
            const uuid = this.uuid(), mode = inverted();
            const value = type => uuid && document.querySelector(`[id="${uuid}"].logical_image_${type} textarea`)?.value;
            const bg = value('background'), fg = value('foreground');
            if (!bg?.startsWith('data:image/')) { this.status.textContent = '参考画像を読み込み、保護または変更したい部分を塗ってください。'; return; }
            if (mode === null) { this.status.textContent = '標準のマスクモードが見つかりません。'; return; }
            this.status.textContent = '変更範囲を更新しています…';
            try {
                const [background, foreground] = await Promise.all([imageFrom(bg), fg?.startsWith('data:image/') ? imageFrom(fg) : null]);
                if (ticket !== this.revision) return;
                const scale = Math.min(1, 1024 / Math.max(background.width, background.height));
                this.canvas.width = Math.max(1, Math.round(background.width * scale)); this.canvas.height = Math.max(1, Math.round(background.height * scale));
                const mask = document.createElement('canvas'); mask.width = this.canvas.width; mask.height = this.canvas.height;
                const mc = mask.getContext('2d', {willReadFrequently: true});
                if (foreground) mc.drawImage(foreground, 0, 0, mask.width, mask.height);
                const pixels = mc.getImageData(0, 0, mask.width, mask.height); let marked = 0;
                for (let i = 0; i < pixels.data.length; i += 4) {
                    const a = pixels.data[i + 3]; if (a > 128) marked++;
                    pixels.data[i] = 255; pixels.data[i + 1] = 35; pixels.data[i + 2] = 55; pixels.data[i + 3] = repaintAlpha(a, mode);
                }
                mc.putImageData(pixels, 0, 0);
                const ctx = this.canvas.getContext('2d'); ctx.drawImage(background, 0, 0, mask.width, mask.height);
                if (this.sketch && foreground) ctx.drawImage(foreground, 0, 0, mask.width, mask.height);
                ctx.drawImage(mask, 0, 0); this.canvas.hidden = false;
                this.status.textContent = marked === 0 ? (mode ? '塗った範囲が空です。逆指定では画像全体が変更対象になります。' : '塗った範囲が空です。変更したい部分を塗ってください。') : '範囲を確認したら、通常の生成ボタンで生成できます。';
            } catch (e) { if (ticket === this.revision) this.status.textContent = e.message; }
        }
    }
    function mount() {
        for (const [id, sketch] of [['img2maskimg', false], ['inpaint_sketch', true]]) {
            const target = document.getElementById(id);
            if (target && !target.dataset.nlcReverse) { target.dataset.nlcReverse = 'true'; new ReversePanel(target, sketch); }
        }
    }
    if (typeof onUiLoaded === 'function') onUiLoaded(mount);
    if (typeof onUiUpdate === 'function') onUiUpdate(mount);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
