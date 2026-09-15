/* Neo Layer Composer v0.1.1 — local canvas composition; no external services. */
(() => {
    'use strict';
    const VERSION = 1;
    const MAX_PIXELS = 24000000;
    const clone = value => JSON.parse(JSON.stringify(value));
    const rad = degrees => degrees * Math.PI / 180;
    const angle = degrees => ((degrees + 180) % 360 + 360) % 360 - 180;
    const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
    const uid = () => crypto.randomUUID();
    function button(label, action, parent) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; b.addEventListener('click', action); parent.append(b); return b;
    }
    function readFile(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('ファイルを読み込めませんでした。')); r.readAsDataURL(file);
        });
    }
    async function decode(src) {
        if (!/^data:image\/(png|jpeg|webp);base64,/i.test(src)) throw new Error('PNG・JPEG・WebP画像を使用してください。');
        const image = new Image(); image.src = src; await image.decode();
        if (!image.width || image.width * image.height > MAX_PIXELS) throw new Error('画像は2,400万画素以下にしてください。');
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', {willReadFrequently: true}); ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, image.width, image.height).data;
        let left = image.width, top = image.height, right = -1, bottom = -1;
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (data[(y * image.width + x) * 4 + 3] > 0) {
            left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        image.nlcBounds = right < 0 ? {x: 0, y: 0, width: image.width, height: image.height} : {x: left, y: top, width: right - left + 1, height: bottom - top + 1};
        return image;
    }
    function download(blob, name) {
        const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    class Composer {
        constructor(target) {
            this.target = target; this.assets = new Map(); this.state = {background: null, layers: [], selected: null};
            this.history = [clone(this.state)]; this.index = 0; this.dirty = false; this.busy = false; this.applied = false; this.drag = null;
            this.root = document.createElement('details'); this.root.id = 'neo-layer-composer';
            this.root.innerHTML = `<summary>レイヤー合成 <small>背景にキャラを配置</small></summary>
              <div class="nlc-body">
                <div class="nlc-toolbar" data-role="files"></div>
                <p class="nlc-help">背景を読み込み、透過キャラをここへドロップ。四隅で拡大縮小、上の丸で回転。矢印キーで微調整。</p>
                <div class="nlc-workspace"><div class="nlc-stage"><canvas tabindex="0" aria-label="レイヤー配置キャンバス。矢印キーで移動、Shift併用で10ピクセル移動。"></canvas></div>
                <aside><strong>レイヤー（上が手前）</strong><div data-role="layers"></div><div class="nlc-toolbar" data-role="order"></div>
                  <div class="nlc-fields"><label>X <input data-field="x" type="number" step="1"></label><label>Y <input data-field="y" type="number" step="1"></label>
                  <label>サイズ % <input data-field="scale" type="number" min="1" max="10000" step="1"></label><label>角度 ° <input data-field="rotation" type="number" step="1"></label></div>
                  <div class="nlc-toolbar" data-role="transform"></div></aside></div>
                <div class="nlc-toolbar" data-role="actions"></div><p class="nlc-status" role="status" aria-live="polite"></p>
              </div>`;
            // Neo reads the first img/canvas in the active img2img panel for source
            // resolution. Keep ForgeCanvas first in DOM so preview pixels are never used.
            target.after(this.root); this.canvas = this.root.querySelector('canvas'); this.status = this.root.querySelector('[role="status"]');
            const role = name => this.root.querySelector(`[data-role="${name}"]`);
            this.backgroundInput = this.fileInput('背景画像', false, '.png,.jpg,.jpeg,.webp', files => this.importImages(files, true));
            this.characterInput = this.fileInput('キャラ画像', true, '.png,.jpg,.jpeg,.webp', files => this.importImages(files, false));
            this.projectInput = this.fileInput('編集ファイル', false, '.json', files => this.loadProject(files[0]));
            button('背景を読み込む', () => this.backgroundInput.click(), role('files'));
            button('キャラを追加', () => this.characterInput.click(), role('files'));
            button('i2iの画像を背景に', () => this.guard(() => this.importCurrent()), role('files'));
            button('レイヤーを初期化', () => this.reset(), role('files'));
            this.expandButton = button('拡大編集', () => { this.root.classList.toggle('nlc-expanded'); this.expandButton.textContent = this.root.classList.contains('nlc-expanded') ? '元の表示へ' : '拡大編集'; this.resize(); }, role('files'));
            button('前へ', () => this.reorder(1), role('order')); button('後ろへ', () => this.reorder(-1), role('order'));
            button('左右反転', () => this.modify(l => l.flip = !l.flip), role('transform'));
            button('回転を0°に', () => this.modify(l => l.rotation = 0), role('transform'));
            button('中央へ', () => this.modify(l => { const b = this.background(); l.x = b.width / 2; l.y = b.height / 2; }), role('transform'));
            button('削除', () => this.remove(), role('transform'));
            this.undoButton = button('元に戻す', () => this.undo(-1), role('actions'));
            this.redoButton = button('やり直す', () => this.undo(1), role('actions'));
            button('編集を保存', () => this.guard(() => this.saveProject()), role('actions'));
            button('編集を開く', () => this.projectInput.click(), role('actions'));
            button('合成PNGを保存', () => this.guard(() => this.savePNG()), role('actions'));
            this.applyButton = button('i2iへ反映', () => this.guard(() => this.apply()), role('actions')); this.applyButton.className = 'nlc-primary';
            const matchLabel = document.createElement('label'); matchLabel.className = 'nlc-match-size';
            this.matchSize = document.createElement('input'); this.matchSize.type = 'checkbox'; this.matchSize.checked = true;
            matchLabel.append(this.matchSize, '反映時に生成サイズも合わせる'); role('actions').after(matchLabel);
            for (const field of this.root.querySelectorAll('[data-field]')) field.addEventListener('input', () => {
                const key = field.dataset.field, value = Number(field.value);
                if (!field.value || !Number.isFinite(value) || (key === 'scale' && (value < 1 || value > 10000)) || Math.abs(value) > 100000) return;
                this.editingField = field;
                try { this.modify(l => l[key] = key === 'scale' ? value / 100 : key === 'rotation' ? angle(value) : value); }
                finally { this.editingField = null; }
            });
            for (const field of this.root.querySelectorAll('[data-field]')) field.addEventListener('blur', () => {
                const l = this.selected(); if (l) field.value = Math.round(l[field.dataset.field] * (field.dataset.field === 'scale' ? 100 : 1) * 100) / 100;
            });
            this.root.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; } });
            this.root.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); const files = [...e.dataTransfer.files]; this.guard(() => this.importImages(files, !this.state.background)); });
            this.canvas.addEventListener('pointerdown', e => this.pointerDown(e));
            this.canvas.addEventListener('pointermove', e => this.pointerMove(e));
            this.canvas.addEventListener('pointerup', () => this.finishDrag());
            this.canvas.addEventListener('pointercancel', () => this.finishDrag(true));
            this.canvas.addEventListener('lostpointercapture', () => this.finishDrag());
            this.root.addEventListener('keydown', e => this.keyDown(e));
            this.root.addEventListener('toggle', () => this.resize());
            new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
            window.addEventListener('beforeunload', e => { if (this.unsaved) { e.preventDefault(); e.returnValue = ''; } });
            this.render();
        }
        fileInput(label, multiple, accept, handler) {
            const input = document.createElement('input'); input.type = 'file'; input.hidden = true; input.multiple = multiple; input.accept = accept; input.setAttribute('aria-label', label);
            input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; if (files.length) this.guard(() => handler(files)); }); this.root.append(input); return input;
        }
        async guard(fn) {
            if (this.busy) return;
            this.busy = true; this.root.classList.add('nlc-busy');
            try { await fn(); } catch (e) { this.message(e.message || String(e), true); console.error('[Neo Layer Composer]', e); }
            finally { this.busy = false; this.root.classList.remove('nlc-busy'); }
        }
        message(text, error = false) { this.status.textContent = text; this.status.classList.toggle('nlc-error', error); }
        background() { return this.assets.get(this.state.background)?.image; }
        selected() { return this.state.layers.find(l => l.id === this.state.selected); }
        reset() {
            if (this.busy || !this.state.background) return;
            this.state = {background: null, layers: [], selected: null}; this.commit();
            this.target.querySelector('button[id^="removeButton_"]')?.click();
            this.message('背景とキャラ、i2iの参考画像を初期化しました。「元に戻す」でレイヤーを復元し、再度i2iへ反映できます。');
        }
        syncGenerationSize(width, height) {
            const w = document.querySelector('#img2img_width input[type="number"]');
            const h = document.querySelector('#img2img_height input[type="number"]');
            if (!w || !h) throw new Error('生成サイズの入力欄が見つかりません。幅・高さを手動で設定してください。');
            for (const [input, value] of [[w, width], [h, height]]) {
                input.value = String(value); input.dispatchEvent(new Event('input', {bubbles: true}));
            }
            document.querySelector('#img2img_tab_resize_to-button')?.click();
        }
        commit() {
            this.history = this.history.slice(0, this.index + 1); this.history.push(clone(this.state));
            if (this.history.length > 51) this.history.shift(); this.index = this.history.length - 1;
            this.dirty = true; this.unsaved = true; this.render();
            this.message('編集しました。生成前に「i2iへ反映」を押してください。編集状態は「編集を保存」で残せます。');
            this.collectAssets();
        }
        collectAssets() {
            const keep = new Set(); for (const s of this.history) { keep.add(s.background); for (const l of s.layers) keep.add(l.asset); }
            for (const key of this.assets.keys()) if (!keep.has(key)) this.assets.delete(key);
        }
        undo(direction) {
            if (this.busy || this.index + direction < 0 || this.index + direction >= this.history.length) return;
            this.index += direction; this.state = clone(this.history[this.index]); this.dirty = true; this.unsaved = true; this.render(); this.message('編集を戻しました。生成前に「i2iへ反映」を押してください。');
        }
        modify(fn) { const l = this.selected(); if (this.busy || !l || l.locked) return; fn(l); this.commit(); }
        remove() { this.modify(l => { this.state.layers = this.state.layers.filter(v => v.id !== l.id); this.state.selected = null; }); }
        reorder(delta) { this.modify(l => { const i = this.state.layers.indexOf(l), j = i + delta; if (j >= 0 && j < this.state.layers.length) [this.state.layers[i], this.state.layers[j]] = [this.state.layers[j], this.state.layers[i]]; }); }
        async importImages(files, asBackground) {
            if (!files.length) return;
            if (!asBackground && !this.background()) throw new Error('先に背景画像を読み込んでください。');
            if (this.state.layers.length + files.length - (asBackground ? 1 : 0) > 40) throw new Error('キャラは最大40レイヤーです。');
            const loaded = [];
            for (const file of files) {
                if (file.size > 40000000) throw new Error('画像ファイルは40MB以下にしてください。');
                const src = await readFile(file), image = await decode(src); loaded.push({id: uid(), src, image, name: file.name});
            }
            for (const a of loaded) this.assets.set(a.id, a);
            if (asBackground) {
                const a = loaded.shift(), old = this.background(); this.state.background = a.id;
                if (old) { const ratio = a.image.width / old.width; for (const l of this.state.layers) { l.x *= ratio; l.y *= a.image.height / old.height; l.scale *= ratio; } }
            }
            const bg = this.background();
            for (const a of loaded) {
                const b = a.image.nlcBounds;
                const l = {id: uid(), asset: a.id, name: a.name, x: bg.width / 2, y: bg.height / 2, scale: Math.max(.01, Math.min(1, bg.width * .65 / b.width, bg.height * .8 / b.height)), rotation: 0, flip: false, visible: true, locked: false};
                this.state.layers.push(l); this.state.selected = l.id;
            }
            this.root.open = true; this.commit(); this.resize();
        }
        async importCurrent() {
            const input = this.target.querySelector('input[id^="imageInput_"]');
            const uuid = input?.id.slice('imageInput_'.length);
            const source = uuid && document.querySelector(`[id="${uuid}"].logical_image_background textarea`);
            if (!source?.value?.startsWith('data:image/png;base64,')) throw new Error('i2iの参考画像がありません。');
            const src = source.value, image = await decode(src), id = uid(); this.assets.set(id, {id, src, image, name: 'i2i背景.png'});
            if (this.background() && (image.width !== this.background().width || image.height !== this.background().height)) {
                const old = this.background(); for (const l of this.state.layers) { l.x *= image.width / old.width; l.y *= image.height / old.height; l.scale *= image.width / old.width; }
            }
            this.state.background = id; this.commit(); this.resize();
        }
        render() {
            const list = this.root.querySelector('[data-role="layers"]'); list.replaceChildren();
            for (const l of [...this.state.layers].reverse()) {
                const row = document.createElement('div'); row.className = 'nlc-layer' + (l.id === this.state.selected ? ' nlc-selected' : '');
                const select = button(l.name, () => { this.state.selected = l.id; this.render(); }, row); select.className = 'nlc-layer-name'; select.title = l.name; select.setAttribute('aria-pressed', l.id === this.state.selected);
                button(l.visible ? '表示' : '非表示', () => { if (this.busy) return; l.visible = !l.visible; this.commit(); }, row).setAttribute('aria-label', `${l.name}の表示切替`);
                button(l.locked ? '固定中' : '固定', () => { if (this.busy) return; l.locked = !l.locked; this.commit(); }, row).setAttribute('aria-label', `${l.name}のロック切替`);
                list.append(row);
            }
            const bgRow = document.createElement('div'); bgRow.className = 'nlc-background'; bgRow.textContent = this.background() ? `背景（固定） ${this.background().width} × ${this.background().height}` : '背景がまだありません'; list.append(bgRow);
            const selected = this.selected();
            for (const field of this.root.querySelectorAll('[data-field]')) { field.disabled = !selected || selected.locked; if (field !== this.editingField) field.value = selected ? Math.round(selected[field.dataset.field] * (field.dataset.field === 'scale' ? 100 : 1) * 100) / 100 : ''; }
            for (const b of this.root.querySelectorAll('[data-role="transform"] button, [data-role="order"] button')) b.disabled = !selected || selected.locked;
            this.undoButton.disabled = this.index === 0; this.redoButton.disabled = this.index === this.history.length - 1; this.applyButton.disabled = !this.background();
            this.applyButton.textContent = this.dirty ? 'i2iへ反映（未反映）' : 'i2iへ反映'; this.draw();
        }
        resize() {
            const r = this.canvas.parentElement.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return;
            this.vw = r.width; this.vh = r.height; const dpr = Math.min(window.devicePixelRatio || 1, 2);
            this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr); this.dpr = dpr; this.draw();
        }
        paint(ctx) {
            const bg = this.background(); if (!bg) return;
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, bg.width, bg.height); ctx.drawImage(bg, 0, 0);
            for (const l of this.state.layers) {
                if (!l.visible) continue; const img = this.assets.get(l.asset).image;
                const b = img.nlcBounds;
                ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(rad(l.rotation)); ctx.scale(l.scale * (l.flip ? -1 : 1), l.scale); ctx.drawImage(img, b.x, b.y, b.width, b.height, -b.width / 2, -b.height / 2, b.width, b.height); ctx.restore();
            }
        }
        points(l) {
            const img = this.assets.get(l.asset).image.nlcBounds, w = img.width * l.scale / 2, h = img.height * l.scale / 2, c = Math.cos(rad(l.rotation)), s = Math.sin(rad(l.rotation));
            return [[-w, -h], [w, -h], [w, h], [-w, h], [0, -h - 30 / this.zoom]].map(([x, y]) => ({x: l.x + c * x - s * y, y: l.y + s * x + c * y}));
        }
        draw() {
            if (!this.vw) return; const ctx = this.canvas.getContext('2d'); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.vw, this.vh);
            const bg = this.background();
            if (!bg) { ctx.fillStyle = '#a8b6c9'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('背景画像をドロップして開始', this.vw / 2, this.vh / 2); return; }
            this.zoom = Math.min((this.vw - 80) / bg.width, (this.vh - 90) / bg.height); this.ox = (this.vw - bg.width * this.zoom) / 2; this.oy = (this.vh - bg.height * this.zoom) / 2;
            ctx.save(); ctx.translate(this.ox, this.oy); ctx.scale(this.zoom, this.zoom);
            ctx.save(); ctx.beginPath(); ctx.rect(0, 0, bg.width, bg.height); ctx.clip(); this.paint(ctx); ctx.restore();
            ctx.strokeStyle = '#8a9bb4'; ctx.lineWidth = 1 / this.zoom; ctx.strokeRect(0, 0, bg.width, bg.height);
            const l = this.selected();
            if (l?.visible) {
                const p = this.points(l); ctx.strokeStyle = l.locked ? '#f2bf64' : '#55d6cf'; ctx.fillStyle = '#142d39'; ctx.lineWidth = 2 / this.zoom;
                ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y); ctx.closePath(); ctx.stroke();
                if (!l.locked) {
                    ctx.beginPath(); ctx.moveTo((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2); ctx.lineTo(p[4].x, p[4].y); ctx.stroke();
                    for (let i = 0; i < 5; i++) { ctx.beginPath(); if (i === 4) ctx.arc(p[i].x, p[i].y, 7 / this.zoom, 0, Math.PI * 2); else ctx.rect(p[i].x - 5 / this.zoom, p[i].y - 5 / this.zoom, 10 / this.zoom, 10 / this.zoom); ctx.fill(); ctx.stroke(); }
                }
            }
            ctx.restore();
        }
        eventPoint(e) { const r = this.canvas.getBoundingClientRect(); return {x: (e.clientX - r.left - this.ox) / this.zoom, y: (e.clientY - r.top - this.oy) / this.zoom}; }
        pointerDown(e) {
            if (e.button !== 0 || this.busy || !this.background()) return; e.preventDefault(); this.canvas.focus(); const p = this.eventPoint(e); let l = this.selected(), handle = -1;
            if (l?.visible && !l.locked) handle = this.points(l).findIndex(q => Math.hypot(p.x - q.x, p.y - q.y) < 13 / this.zoom);
            if (handle < 0) {
                l = [...this.state.layers].reverse().find(v => {
                    if (!v.visible || v.locked) return false; const img = this.assets.get(v.asset).image.nlcBounds, a = rad(-v.rotation), dx = p.x - v.x, dy = p.y - v.y;
                    return Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= img.width * v.scale / 2 && Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= img.height * v.scale / 2;
                }); this.state.selected = l?.id || null; this.render();
            }
            if (!l || l.locked) return;
            this.drag = {id: l.id, start: p, original: clone(l), handle, changed: false}; this.canvas.setPointerCapture(e.pointerId);
        }
        pointerMove(e) {
            if (!this.drag) return; const d = this.drag, l = this.state.layers.find(v => v.id === d.id), p = this.eventPoint(e), o = d.original;
            if (d.handle === 4) { l.rotation = angle(o.rotation + (Math.atan2(p.y - o.y, p.x - o.x) - Math.atan2(d.start.y - o.y, d.start.x - o.x)) * 180 / Math.PI); if (e.shiftKey) l.rotation = Math.round(l.rotation / 15) * 15; }
            else if (d.handle >= 0) l.scale = Math.max(.01, Math.min(100, o.scale * Math.hypot(p.x - o.x, p.y - o.y) / Math.max(.01, Math.hypot(d.start.x - o.x, d.start.y - o.y))));
            else { l.x = o.x + p.x - d.start.x; l.y = o.y + p.y - d.start.y; }
            d.changed = true; this.draw();
        }
        finishDrag(cancel = false) {
            if (!this.drag) return; const d = this.drag; this.drag = null;
            if (cancel) Object.assign(this.state.layers.find(l => l.id === d.id), d.original);
            if (d.changed && !cancel) this.commit(); else this.render();
        }
        keyDown(e) {
            if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.stopPropagation(); return; }
            if (e.key === 'Escape') { e.stopPropagation(); this.finishDrag(true); this.root.classList.remove('nlc-expanded'); this.expandButton.textContent = '拡大編集'; this.resize(); return; }
            if (e.ctrlKey || e.metaKey) {
                if (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); this.undo(e.shiftKey || e.key.toLowerCase() === 'y' ? 1 : -1); } return;
            }
            const movement = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key];
            if (movement && e.target === this.canvas) { e.preventDefault(); e.stopPropagation(); const step = e.shiftKey ? 10 : 1; this.modify(l => { l.x += movement[0] * step; l.y += movement[1] * step; }); }
            if (e.key === 'Delete' && e.target === this.canvas) { e.preventDefault(); e.stopPropagation(); this.remove(); }
        }
        exportCanvas() {
            const bg = this.background(); if (!bg) throw new Error('先に背景画像を読み込んでください。');
            const canvas = document.createElement('canvas'); canvas.width = bg.width; canvas.height = bg.height; this.paint(canvas.getContext('2d')); return canvas;
        }
        async savePNG() { const canvas = this.exportCanvas(); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('PNGの作成に失敗しました。'); download(blob, 'neo-composition.png'); this.message('合成PNGを保存しました。レイヤーを残すには「編集を保存」も使用してください。'); }
        async saveProject() {
            if (!this.background()) throw new Error('先に背景画像を読み込んでください。');
            const ids = new Set([this.state.background, ...this.state.layers.map(l => l.asset)]);
            const assets = [...ids].map(id => { const a = this.assets.get(id); return {id, name: a.name, src: a.src}; });
            const project = {format: 'neo-layer-composer', version: VERSION, state: this.state, assets};
            download(new Blob([JSON.stringify(project)], {type: 'application/json'}), 'neo-layers.json'); this.unsaved = false; this.message('画像と配置を含む編集ファイルを保存しました。');
        }
        async loadProject(file) {
            if (!file) return; if (file.size > 200000000) throw new Error('編集ファイルは200MB以下にしてください。');
            const p = JSON.parse(await file.text());
            if (p.format !== 'neo-layer-composer' || p.version !== VERSION || !Array.isArray(p.assets) || p.assets.length > 41 || !Array.isArray(p.state?.layers) || p.state.layers.length > 40) throw new Error('対応していない編集ファイルです。');
            const assets = new Map();
            for (const a of p.assets) {
                if (typeof a.id !== 'string' || assets.has(a.id) || typeof a.name !== 'string' || a.name.length > 1000 || typeof a.src !== 'string') throw new Error('画像データが不正です。');
                assets.set(a.id, {id: a.id, name: a.name, src: a.src, image: await decode(a.src)});
            }
            if (!assets.has(p.state.background)) throw new Error('背景画像がありません。');
            const layerIds = new Set(), layers = [];
            for (const l of p.state.layers) {
                if (!l || typeof l.id !== 'string' || layerIds.has(l.id) || !assets.has(l.asset) || typeof l.name !== 'string' || l.name.length > 1000 || !finite(l.x, -100000, 100000) || !finite(l.y, -100000, 100000) || !finite(l.scale, .01, 100) || !finite(l.rotation, -360, 360) || ['flip', 'visible', 'locked'].some(k => typeof l[k] !== 'boolean')) throw new Error('レイヤー情報が不正です。');
                layerIds.add(l.id); layers.push({id: l.id, asset: l.asset, name: l.name, x: l.x, y: l.y, scale: l.scale, rotation: l.rotation, flip: l.flip, visible: l.visible, locked: l.locked});
            }
            // Remap imported asset IDs so undo can safely retain the previous project's images.
            const map = new Map(); for (const [id, a] of assets) { const fresh = uid(); map.set(id, fresh); this.assets.set(fresh, {...a, id: fresh}); }
            this.state = {background: map.get(p.state.background), layers: layers.map(l => ({...l, asset: map.get(l.asset)})), selected: layerIds.has(p.state.selected) ? p.state.selected : null};
            this.root.open = true; this.commit(); this.unsaved = false; this.resize(); this.message('編集を読み込みました。生成前に「i2iへ反映」を押してください。');
        }
        async apply() {
            const canvas = this.exportCanvas(), src = canvas.toDataURL('image/png');
            const input = this.target.querySelector('input[id^="imageInput_"]');
            const uuid = input?.id.slice('imageInput_'.length);
            const bridge = uuid && document.querySelector(`[id="${uuid}"].logical_image_background textarea`);
            if (!input || !bridge) throw new Error('Forgeの画像入力が見つかりません。ページを再読み込みしてください。');
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('合成画像を作成できませんでした。');
            const dt = new DataTransfer(); dt.items.add(new File([blob], 'neo-composition.png', {type: 'image/png'})); input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles: true}));
            const start = performance.now();
            // Forge serializes the loaded image back to its Gradio-bound textarea.
            while (performance.now() - start < 10000) {
                if (bridge.value === src) break;
                const shown = this.target.querySelector('img[id^="image_"]');
                if (shown?.src === src && bridge.value?.startsWith('data:image/png;base64,')) break;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (performance.now() - start >= 10000) throw new Error('画像の反映を確認できませんでした。i2iの参考画像を確認してください。');
            if (this.matchSize.checked) this.syncGenerationSize(canvas.width, canvas.height);
            this.dirty = false; this.applied = true; this.render(); this.message(`i2iへ反映しました（${canvas.width} × ${canvas.height}）。${this.matchSize.checked ? '生成サイズも合わせました。' : '生成サイズはi2i側で設定してください。'}通常の生成ボタンで生成できます。`);
        }
    }
    function mount() {
        const target = document.querySelector('#img2img_image');
        if (target && !document.querySelector('#neo-layer-composer')) window.neoLayerComposer = new Composer(target);
    }
    if (typeof onUiLoaded === 'function') onUiLoaded(mount);
    if (typeof onUiUpdate === 'function') onUiUpdate(mount);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
