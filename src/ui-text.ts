import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const INVERSE_SPACE = "\x1b[7m \x1b[27m";

function tailToWidth(value: string, width: number): string {
	if (width <= 0) return "";
	const chars = Array.from(value);
	while (chars.length > 0 && visibleWidth(chars.join("")) > width) chars.shift();
	return chars.join("");
}

/** Render a single-line editable value while reserving a visible cursor cell.
 * Long values keep their tail, matching the part users are actively editing. */
export function renderEditableValue(value: string, placeholder: string, width: number, focused: boolean): string {
	const safeWidth = Math.max(0, width);
	const cursor = focused ? `${CURSOR_MARKER}${INVERSE_SPACE}` : "";
	const cursorWidth = focused ? 1 : 0;
	const contentWidth = Math.max(0, safeWidth - cursorWidth);
	if (value.length > 0) return `${tailToWidth(value, contentWidth)}${cursor}`;
	const visiblePlaceholder = truncateToWidth(placeholder, contentWidth, "");
	return focused ? `${cursor}${visiblePlaceholder}` : visiblePlaceholder;
}
