export const DEFAULT_PAGE_SIZE = 25;

export const PAGE_SIZE_OPTIONS = Object.freeze([
    { value: 25, label: '25' },
    { value: 50, label: '50' },
    { value: 100, label: '100' },
    { value: 150, label: '150' },
    { value: 0, label: 'All' }
]);

export const createPaginationState = (initialPageSize = DEFAULT_PAGE_SIZE) => ({
    page: 1,
    pageSize: initialPageSize
});

export const resetPaginationPage = (state) => {
    if (state) state.page = 1;
};

export const paginateArray = (items = [], state = { page: 1, pageSize: DEFAULT_PAGE_SIZE }) => {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const rawSize = Number(state?.pageSize);
    const pageSize = Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : DEFAULT_PAGE_SIZE;
    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    const currentPage = Math.min(Math.max(1, Number(state?.page) || 1), totalPages);

    if (state) {
        state.page = currentPage;
        state.pageSize = pageSize;
    }

    const startIndex = pageSize > 0 ? (currentPage - 1) * pageSize : 0;
    const endIndex = pageSize > 0 ? Math.min(startIndex + pageSize, total) : total;

    return {
        items: list.slice(startIndex, endIndex),
        total,
        pageSize,
        currentPage,
        totalPages,
        startIndex,
        endIndex,
        startNum: total === 0 ? 0 : startIndex + 1,
        endNum: total === 0 ? 0 : endIndex
    };
};

export const hidePaginationControls = (...elements) => {
    elements.forEach((el) => {
        const node = typeof el === 'string' ? document.getElementById(el) : el;
        if (!node) return;
        node.classList.add('hidden');
        node.innerHTML = '';
    });
};

export const renderPaginationControls = ({
    topEl = null,
    bottomEl = null,
    pageInfo,
    state,
    itemLabel = 'students',
    onRender
} = {}) => {
    const topNode = typeof topEl === 'string' ? document.getElementById(topEl) : topEl;
    const bottomNode = typeof bottomEl === 'string' ? document.getElementById(bottomEl) : bottomEl;

    if (!pageInfo || pageInfo.total <= 0) {
        hidePaginationControls(topNode, bottomNode);
        return;
    }

    const { total, pageSize, currentPage, totalPages, startNum, endNum } = pageInfo;
    const isPrevDisabled = currentPage <= 1;
    const isNextDisabled = currentPage >= totalPages;

    const optionsHtml = PAGE_SIZE_OPTIONS.map((opt) => (
        `<option value="${opt.value}" ${Number(pageSize) === opt.value ? 'selected' : ''}>${opt.label}</option>`
    )).join('');

    const handlePageSizeChange = (newVal) => {
        const parsed = Number(newVal);
        if (state) {
            state.pageSize = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PAGE_SIZE;
            state.page = 1;
        }
        if (typeof onRender === 'function') onRender();
    };

    const handlePageStep = (delta) => {
        if (!state) return;
        const next = Math.min(Math.max(1, currentPage + delta), totalPages);
        if (next === currentPage) return;
        state.page = next;
        if (typeof onRender === 'function') onRender();
    };

    if (topNode) {
        topNode.classList.remove('hidden');
        topNode.className = 'no-print flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs';
        topNode.innerHTML = `
            <div class="flex items-center gap-2 font-bold text-slate-700 flex-wrap">
                <span>Rows:</span>
                <select data-pagination-size class="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-extrabold text-slate-800 text-xs shadow-2xs outline-none cursor-pointer">
                    ${optionsHtml}
                </select>
                <span class="text-slate-500 font-semibold ml-1 tabular-nums">Showing ${startNum}–${endNum} of ${total}</span>
            </div>
            <div class="flex items-center gap-1.5">
                <button type="button" data-pagination-prev ${isPrevDisabled ? 'disabled' : ''} class="px-3 py-1 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer transition flex items-center gap-1">
                    <i class="fas fa-chevron-left text-[10px]"></i> Prev
                </button>
                <span class="font-extrabold text-slate-800 px-2 tabular-nums">Page ${currentPage} / ${totalPages}</span>
                <button type="button" data-pagination-next ${isNextDisabled ? 'disabled' : ''} class="px-3 py-1 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer transition flex items-center gap-1">
                    Next <i class="fas fa-chevron-right text-[10px]"></i>
                </button>
            </div>
        `;
        topNode.querySelector('[data-pagination-size]')?.addEventListener('change', (e) => {
            handlePageSizeChange(e.target.value);
        });
        topNode.querySelector('[data-pagination-prev]')?.addEventListener('click', () => handlePageStep(-1));
        topNode.querySelector('[data-pagination-next]')?.addEventListener('click', () => handlePageStep(1));
    }

    if (bottomNode) {
        bottomNode.classList.remove('hidden');
        bottomNode.className = 'no-print flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs';
        bottomNode.innerHTML = `
            <div class="font-bold text-slate-600 tabular-nums">Showing rows ${startNum} to ${endNum} of ${total} ${itemLabel}</div>
            <div class="flex items-center gap-2">
                <button type="button" data-pagination-prev ${isPrevDisabled ? 'disabled' : ''} class="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white font-extrabold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer transition flex items-center gap-1">
                    <i class="fas fa-chevron-left text-[10px]"></i> Previous
                </button>
                <span class="font-extrabold text-slate-800 px-2 tabular-nums">Page ${currentPage} / ${totalPages}</span>
                <button type="button" data-pagination-next ${isNextDisabled ? 'disabled' : ''} class="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white font-extrabold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer transition flex items-center gap-1">
                    Next <i class="fas fa-chevron-right text-[10px]"></i>
                </button>
            </div>
        `;
        bottomNode.querySelector('[data-pagination-prev]')?.addEventListener('click', () => handlePageStep(-1));
        bottomNode.querySelector('[data-pagination-next]')?.addEventListener('click', () => handlePageStep(1));
    }
};
