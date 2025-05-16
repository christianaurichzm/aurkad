type OptionRenderer<T> = (item: T) => { value: string; label: string };

export function setupAsyncSelect<T>(
  selectId: string,
  placeholder: string,
  fetchFn: () => Promise<T[]>,
  renderOption: OptionRenderer<T>,
) {
  const select = document.getElementById(selectId) as HTMLSelectElement;
  if (!select) return;

  let loaded = false;

  select.addEventListener('focus', async function handleFocus() {
    if (loaded) return;
    select.innerHTML = `<option value="">Loading...</option>`;
    const items = await fetchFn();
    select.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach((item) => {
      const { value, label } = renderOption(item);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    loaded = true;
  });
}
