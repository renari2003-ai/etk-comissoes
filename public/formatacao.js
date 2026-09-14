/** Formatadores compartilhados entre a consulta individual e os relatórios agregados. */
export function formatarMoeda(valor) {
    if (valor === null)
        return '—';
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export function formatarPercentual(valor) {
    if (valor === null)
        return 'N/A';
    return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
