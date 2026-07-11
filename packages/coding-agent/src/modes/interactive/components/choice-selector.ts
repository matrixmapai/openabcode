import { Container, type SelectItem, SelectList, Spacer, Text } from "@openabcode/tui";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

export class ChoiceSelectorComponent extends Container {
	private readonly selectList: SelectList;

	constructor(
		title: string,
		items: SelectItem[],
		currentValue: string | undefined,
		onSelect: (value: string) => void,
		onCancel: () => void,
		hint?: string,
	) {
		super();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
		this.addChild(new Spacer(1));

		this.selectList = new SelectList(items, Math.min(items.length, 10), getSelectListTheme());
		const currentIndex = items.findIndex((item) => item.value === currentValue);
		if (currentIndex >= 0) this.selectList.setSelectedIndex(currentIndex);
		this.selectList.onSelect = (item) => onSelect(item.value);
		this.selectList.onCancel = onCancel;
		this.addChild(this.selectList);

		if (hint) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", hint), 0, 0));
		}
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
