import { observer } from "mobx-react";
import { PlusIcon } from "outline-icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { DocumentPropertyType } from "@shared/types";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import useMobile from "~/hooks/useMobile";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "./primitives/Drawer";
import { Popover, PopoverContent, PopoverTrigger } from "./primitives/Popover";
import Text from "./Text";

export interface PropertyPickerItem {
  id: string;
  name: string;
  type: DocumentPropertyType;
}

export interface PropertyPickerCreateValues {
  name: string;
  type: DocumentPropertyType;
}

export interface PropertyPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  searchPlaceholder: string;
  emptyMessage: string;
  items: PropertyPickerItem[];
  onSelect: (item: PropertyPickerItem) => void;
  onCreate?: (values: PropertyPickerCreateValues) => Promise<void>;
  disabled?: boolean;
  showItemsOnEmpty?: boolean;
  emptySectionTitle?: string;
}

/**
 * Returns the translated label for a document property type.
 *
 * @param type The property type to describe.
 * @param t The translation function.
 * @returns The localized property type label.
 */
export function propertyTypeLabel(
  type: DocumentPropertyType,
  t: (key: string, options?: Record<string, string>) => string
) {
  switch (type) {
    case DocumentPropertyType.Text:
      return t("Text");
    case DocumentPropertyType.Number:
      return t("Number");
    case DocumentPropertyType.Date:
      return t("Date");
    case DocumentPropertyType.Select:
      return t("Select");
    case DocumentPropertyType.MultiSelect:
      return t("Multi-select");
    case DocumentPropertyType.User:
      return t("User");
    default:
      return type;
  }
}

/**
 * Search and quick-create picker for property selection.
 *
 * @param props The component props.
 * @returns A popover on desktop and drawer on mobile.
 */
export const PropertyPicker = observer(function PropertyPicker({
  open,
  onOpenChange,
  trigger,
  title,
  searchPlaceholder,
  emptyMessage,
  items,
  onSelect,
  onCreate,
  disabled,
  showItemsOnEmpty,
  emptySectionTitle,
}: PropertyPickerProps) {
  const isMobile = useMobile();
  const content = (
    <PropertyPickerContent
      open={open}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      items={items}
      onSelect={onSelect}
      onCreate={onCreate}
      onClose={() => onOpenChange(false)}
      showItemsOnEmpty={showItemsOnEmpty}
      emptySectionTitle={emptySectionTitle}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger asChild disabled={disabled}>
          {trigger}
        </DrawerTrigger>
        <DrawerContent aria-label={title}>
          <DrawerTitle>{title}</DrawerTitle>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={true}>
      <PopoverTrigger disabled={disabled}>{trigger}</PopoverTrigger>
      <PopoverContent
        aria-label={title}
        width={360}
        align="end"
        scrollable={false}
        shrink
      >
        {content}
      </PopoverContent>
    </Popover>
  );
});

interface PropertyPickerContentProps {
  open: boolean;
  searchPlaceholder: string;
  emptyMessage: string;
  items: PropertyPickerItem[];
  onSelect: (item: PropertyPickerItem) => void;
  onCreate?: (values: PropertyPickerCreateValues) => Promise<void>;
  onClose: () => void;
  showItemsOnEmpty?: boolean;
  emptySectionTitle?: string;
}

function isDocumentPropertyType(value: string): value is DocumentPropertyType {
  return Object.values(DocumentPropertyType).includes(
    value as DocumentPropertyType
  );
}

function PropertyPickerContent({
  open,
  searchPlaceholder,
  emptyMessage,
  items,
  onSelect,
  onCreate,
  onClose,
  showItemsOnEmpty,
  emptySectionTitle,
}: PropertyPickerContentProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<DocumentPropertyType>(
    DocumentPropertyType.Text
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const typeOptions = useMemo<Option[]>(
    () => [
      {
        type: "item",
        label: propertyTypeLabel(DocumentPropertyType.Text, t),
        value: DocumentPropertyType.Text,
      },
      {
        type: "item",
        label: propertyTypeLabel(DocumentPropertyType.Number, t),
        value: DocumentPropertyType.Number,
      },
      {
        type: "item",
        label: propertyTypeLabel(DocumentPropertyType.Date, t),
        value: DocumentPropertyType.Date,
      },
      {
        type: "item",
        label: propertyTypeLabel(DocumentPropertyType.Select, t),
        value: DocumentPropertyType.Select,
      },
      {
        type: "item",
        label: propertyTypeLabel(DocumentPropertyType.MultiSelect, t),
        value: DocumentPropertyType.MultiSelect,
      },
      {
        type: "item",
        label: propertyTypeLabel(DocumentPropertyType.User, t),
        value: DocumentPropertyType.User,
      },
    ],
    [t]
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return [];
    }

    return [...items]
      .sort((a, b) => {
        const aName = a.name.toLocaleLowerCase();
        const bName = b.name.toLocaleLowerCase();
        const aStartsWith = aName.startsWith(normalizedQuery) ? 0 : 1;
        const bStartsWith = bName.startsWith(normalizedQuery) ? 0 : 1;

        if (aStartsWith !== bStartsWith) {
          return aStartsWith - bStartsWith;
        }

        return a.name.localeCompare(b.name);
      })
      .filter((item) =>
        item.name.toLocaleLowerCase().includes(normalizedQuery)
      );
  }, [items, query]);

  const shouldShowItemsOnEmpty = showItemsOnEmpty ?? items.length > 0;

  const visibleItems = (
    query.trim() ? filteredItems : shouldShowItemsOnEmpty ? items : []
  ).slice(0, 20);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightedIndex(0);
      setIsCreating(false);
      setCreateName("");
      setCreateType(DocumentPropertyType.Text);
      setIsSubmitting(false);
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (isCreating) {
        createNameRef.current?.focus();
        return;
      }

      searchRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [isCreating, open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [isCreating, query, visibleItems.length]);

  const handleSelect = useCallback(
    (item: PropertyPickerItem) => {
      onSelect(item);
      onClose();
    },
    [onClose, onSelect]
  );

  const handleStartCreate = useCallback(() => {
    setCreateName(query.trim());
    setCreateType(DocumentPropertyType.Text);
    setIsCreating(true);
  }, [query]);

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false);
    setCreateName(query.trim());
  }, [query]);

  const handleSubmitCreate = useCallback(async () => {
    if (!onCreate) {
      return;
    }

    const name = createName.trim();
    if (!name) {
      toast.error(t("Property name is required"));
      return;
    }

    setIsSubmitting(true);

    try {
      await onCreate({
        name,
        type: createType,
      });
      onClose();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }, [createName, createType, onClose, onCreate, t]);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!visibleItems.length) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((current) =>
          current >= visibleItems.length - 1 ? 0 : current + 1
        );
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((current) =>
          current <= 0 ? visibleItems.length - 1 : current - 1
        );
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const selectedItem = visibleItems[highlightedIndex];
        if (selectedItem) {
          handleSelect(selectedItem);
        }
      }
    },
    [handleSelect, highlightedIndex, visibleItems]
  );

  const showCreateAction = !!onCreate && !isCreating;
  const showCreateHint =
    createType === DocumentPropertyType.Select ||
    createType === DocumentPropertyType.MultiSelect;

  return (
    <PickerLayout>
      {!isCreating && (
        <Input
          ref={searchRef}
          type="search"
          label={searchPlaceholder}
          labelHidden
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          margin={0}
        />
      )}
      {isCreating ? (
        <CreatePanel>
          <Input
            ref={createNameRef}
            label={t("Property name")}
            placeholder={t("For example: Owner")}
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            margin={0}
            onRequestSubmit={() => void handleSubmitCreate()}
          />
          <InputSelect
            label={t("Property type")}
            options={typeOptions}
            value={createType}
            onChange={(value) => {
              if (isDocumentPropertyType(value)) {
                setCreateType(value);
              }
            }}
          />
          {showCreateHint && (
            <CreateHint type="secondary" size="small">
              {t(
                "You can add choices in workspace settings after creating it."
              )}
            </CreateHint>
          )}
          <CreateActions align="center" justify="flex-end" gap={8}>
            <Button
              type="button"
              neutral
              onClick={handleCancelCreate}
              disabled={isSubmitting}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmitCreate()}
              disabled={isSubmitting}
            >
              {t("Create property")}
            </Button>
          </CreateActions>
        </CreatePanel>
      ) : visibleItems.length > 0 ? (
        <ResultsSection>
          {!query.trim() && emptySectionTitle ? (
            <SectionTitle type="secondary" size="small" weight="bold">
              {emptySectionTitle}
            </SectionTitle>
          ) : null}
          <Results role="listbox" aria-label={t("Properties")}>
            {visibleItems.map((item, index) => (
              <ResultButton
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === highlightedIndex}
                data-highlighted={index === highlightedIndex}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => handleSelect(item)}
              >
                <ResultName>{item.name}</ResultName>
                <TypeBadge>{propertyTypeLabel(item.type, t)}</TypeBadge>
              </ResultButton>
            ))}
          </Results>
        </ResultsSection>
      ) : (
        <EmptyState>
          <Text type="secondary" size="small">
            {query.trim()
              ? t("No properties match “{{query}}”.", { query: query.trim() })
              : emptyMessage}
          </Text>
        </EmptyState>
      )}
      {showCreateAction && (
        <CreateButton
          type="button"
          onClick={handleStartCreate}
          disabled={isSubmitting}
        >
          <PlusIcon size={14} />
          <span>
            {query.trim()
              ? t("Create “{{name}}”", { name: query.trim() })
              : t("Create new property")}
          </span>
        </CreateButton>
      )}
    </PickerLayout>
  );
}

const PickerLayout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ResultsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SectionTitle = styled(Text)`
  padding: 0 10px;
  text-transform: uppercase;
`;

const Results = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
  padding: 0 4px;
`;

const ResultButton = styled.button`
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;

  &:hover,
  &[data-highlighted="true"] {
    background: ${(props) => props.theme.sidebarControlHoverBackground};
  }
`;

const ResultName = styled.span`
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TypeBadge = styled.span`
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 11px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${(props) => props.theme.textTertiary};
  background: ${(props) => props.theme.buttonNeutralBackground};
`;

const EmptyState = styled.div`
  padding: 10px 12px 6px;
`;

const CreateButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 8px);
  margin: 0 4px;
  padding: 10px 12px;
  border: 1px dashed ${(props) => props.theme.divider};
  border-radius: 8px;
  background: transparent;
  color: ${(props) => props.theme.textSecondary};
  cursor: pointer;

  &:hover {
    background: ${(props) => props.theme.sidebarControlHoverBackground};
  }
`;

const CreatePanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 4px 4px;
`;

const CreateHint = styled(Text)`
  margin: -4px 0 0;
`;

const CreateActions = styled(Flex)`
  margin-top: 2px;
`;
