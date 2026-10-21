import { useTranslations } from "next-intl";
import { categoryGroupsFor } from "../categories";
import type { TransactionKind } from "../kinds";
import { useCategoryName } from "./use-category-name";

type Props = {
  id: string;
  kinds: readonly TransactionKind[];
  value: string;
  onChange: (value: string) => void;
  /** Text of the empty option. */
  emptyLabel: string;
};

/** A select with the category groups of the given types; subcategories are indented under their group. */
export function CategorySelect({ id, kinds, value, onChange, emptyLabel }: Props) {
  const t = useTranslations("transactions");
  const name = useCategoryName();
  return (
    <select id={id} className="select w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {kinds.map((kind) =>
        categoryGroupsFor(kind).length === 0 ? null : (
          <optgroup key={kind} label={t(`kinds.${kind}`)}>
            {categoryGroupsFor(kind).flatMap((group) => [
              <option key={group.key} value={group.key}>
                {name(group.key)}
              </option>,
              ...group.subcategories.map((sub) => (
                <option key={`${group.key}.${sub}`} value={`${group.key}.${sub}`}>
                  {"   "}
                  {name(`${group.key}.${sub}`)}
                </option>
              )),
            ])}
          </optgroup>
        ),
      )}
    </select>
  );
}
