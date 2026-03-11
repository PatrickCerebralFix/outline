import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  type DraggableAttributes,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import fractionalIndex from "fractional-index";
import { observer } from "mobx-react";
import { QuestionMarkIcon, SortManualIcon } from "outline-icons";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import { toast } from "sonner";
import styled from "styled-components";
import Button from "~/components/Button";
import { Collapsible } from "~/components/Collapsible";
import Flex from "~/components/Flex";
import { ArrowDownIcon, ArrowUpIcon } from "~/components/Icons/ArrowIcon";
import NudeButton from "~/components/NudeButton";
import {
  PropertyPicker,
  type PropertyPickerCreateValues,
  type PropertyPickerItem,
  propertyTypeLabel,
} from "~/components/PropertyPicker";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import Tooltip from "~/components/Tooltip";
import { client } from "~/utils/ApiClient";
import { settingsPath } from "~/utils/routeHelpers";
import {
  createPreviousIndex,
  deriveCollectionPropertyDefinitionsState,
  equalDraftRows,
  removeDraftRow,
  toDraftRows,
  type CollectionPropertyDefinitionsSnapshot,
  type CollectionPropertyDisplayRow,
  type DraftCollectionPropertyDefinitionRow,
  type PropertyDefinitionData,
  upsertDraftRow,
} from "./CollectionPropertyDefinitionsState";

interface CollectionPropertyDefinitionsProps {
  collectionId: string;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  title?: string;
  description?: string | null;
  showManageDefinitionsLink?: boolean;
  reorderMode?: "buttons" | "drag";
  showPickerResultsOnEmpty?: boolean;
  saveMode?: "immediate" | "deferred";
  onUpdate?: () => void | Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
}

export interface CollectionPropertyDefinitionsHandle {
  submitChanges: () => Promise<boolean>;
}

const emptySnapshot: CollectionPropertyDefinitionsSnapshot = {
  effective: [],
  hidden: [],
  local: [],
  available: [],
};

interface CollectionPropertyRowProps {
  row: CollectionPropertyDisplayRow;
  localRow?: DraftCollectionPropertyDefinitionRow;
  index: number;
  total: number;
  isSaving: boolean;
  reorderMode: "buttons" | "drag";
  onMove: (row: CollectionPropertyDisplayRow, direction: -1 | 1) => void;
  onHide: (row: CollectionPropertyDisplayRow) => void;
  onShow: (row: CollectionPropertyDisplayRow) => void;
  onRemove: (row: CollectionPropertyDisplayRow) => void;
  onToggleRequired: (
    row: CollectionPropertyDisplayRow,
    required: boolean
  ) => void;
  onToggleInheritToChildren: (
    row: CollectionPropertyDisplayRow,
    inheritToChildren: boolean
  ) => void;
}

/**
 * Collection-scoped property manager used in collection editing and workspace settings.
 *
 * @param props The component props.
 * @returns The rendered property management surface.
 */
export const CollectionPropertyDefinitions = observer(
  forwardRef<
    CollectionPropertyDefinitionsHandle,
    CollectionPropertyDefinitionsProps
  >(function CollectionPropertyDefinitions(
    {
      collectionId,
      className,
      collapsible = true,
      defaultOpen = true,
      title,
      description = null,
      showManageDefinitionsLink = true,
      reorderMode = "buttons",
      showPickerResultsOnEmpty = true,
      saveMode = "immediate",
      onUpdate,
      onDirtyChange,
    }: CollectionPropertyDefinitionsProps,
    ref
  ) {
    const history = useHistory();
    const { t } = useTranslation();
    const [snapshot, setSnapshot] =
      useState<CollectionPropertyDefinitionsSnapshot>(emptySnapshot);
    const [draftRows, setDraftRows] = useState<
      DraftCollectionPropertyDefinitionRow[]
    >([]);
    const [draftDefinitions, setDraftDefinitions] = useState<
      PropertyDefinitionData[]
    >([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);

    const baseDraftRows = useMemo(
      () => toDraftRows(snapshot.local),
      [snapshot.local]
    );
    const derivedSnapshot = useMemo(
      () => ({
        ...snapshot,
        available: [
          ...snapshot.available.filter(
            (definition) =>
              !draftDefinitions.some((draft) => draft.id === definition.id)
          ),
          ...draftDefinitions,
        ],
      }),
      [draftDefinitions, snapshot]
    );
    const hasPendingChanges = useMemo(
      () =>
        saveMode === "deferred" &&
        (!equalDraftRows(draftRows, baseDraftRows) || draftDefinitions.length > 0),
      [baseDraftRows, draftDefinitions.length, draftRows, saveMode]
    );
    const derivedState = useMemo(
      () =>
        deriveCollectionPropertyDefinitionsState({
          snapshot: derivedSnapshot,
          draftRows,
          collectionId,
        }),
      [collectionId, derivedSnapshot, draftRows]
    );
    const currentEffectiveRows = derivedState.effective;
    const currentHiddenRows = derivedState.hidden;

    const loadDefinitions = useCallback(async () => {
      setIsLoading(true);

      try {
        const res = await client.post<{
          data: CollectionPropertyDefinitionsSnapshot;
        }>("/collectionPropertyDefinitions.list", {
          collectionId,
        });
        setSnapshot({
          effective: res.data.effective ?? [],
          hidden: res.data.hidden ?? [],
          local: res.data.local ?? [],
          available: res.data.available ?? [],
        });
        setDraftRows(toDraftRows(res.data.local ?? []));
        setDraftDefinitions([]);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    }, [collectionId]);

    useEffect(() => {
      void loadDefinitions();
    }, [loadDefinitions]);

    useEffect(() => {
      onDirtyChange?.(hasPendingChanges);
    }, [hasPendingChanges, onDirtyChange]);

    const localRowsByDefinitionId = useMemo(
      () => new Map(draftRows.map((row) => [row.propertyDefinitionId, row])),
      [draftRows]
    );

    const persistDraftRows = useCallback(
      async (rows: DraftCollectionPropertyDefinitionRow[]) => {
        if (saveMode === "deferred") {
          setDraftRows(rows);
          return;
        }

        setIsSaving(true);

        try {
          await client.post("/collectionPropertyDefinitions.save", {
            collectionId,
            rows: rows.map((row) => ({
              propertyDefinitionId: row.propertyDefinitionId,
              state: row.state,
              required: row.required,
              inheritToChildren: row.inheritToChildren,
              index: row.index,
            })),
            replaceLocal: true,
          });
          await loadDefinitions();
          await onUpdate?.();
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setIsSaving(false);
        }
      },
      [collectionId, loadDefinitions, onUpdate, saveMode]
    );

    const submitChanges = useCallback(async () => {
      if (saveMode !== "deferred" || !hasPendingChanges) {
        return true;
      }

      setIsSaving(true);
      try {
        const definitions = draftDefinitions.map((definition) => ({
          tempId: definition.id,
          name: definition.name,
          description: definition.description ?? null,
          type: definition.type,
          options: [],
        }));
        await client.post("/collectionPropertyDefinitions.save", {
          collectionId,
          definitions,
          rows: draftRows.map((row) => ({
            propertyDefinitionId: row.propertyDefinitionId,
            state: row.state,
            required: row.required,
            inheritToChildren: row.inheritToChildren,
            index: row.index,
          })),
          replaceLocal: true,
        });
        await loadDefinitions();
        await onUpdate?.();
        return true;
      } catch (err) {
        toast.error((err as Error).message);
        return false;
      } finally {
        setIsSaving(false);
      }
    }, [
      collectionId,
      draftDefinitions,
      draftRows,
      hasPendingChanges,
      loadDefinitions,
      onUpdate,
      saveMode,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        submitChanges,
      }),
      [submitChanges]
    );

    const buildReorderedRows = useCallback(
      (rows: CollectionPropertyDisplayRow[]) => {
        let previousIndex: string | null = null;
        const reorderedDefinitionIds = new Set(
          rows.map((row) => row.propertyDefinitionId)
        );
        const preservedRows = draftRows.filter(
          (row) =>
            row.state === "excluded" ||
            !reorderedDefinitionIds.has(row.propertyDefinitionId)
        );

        return [
          ...preservedRows,
          ...rows.map((currentRow) => {
            const localRow = localRowsByDefinitionId.get(
              currentRow.propertyDefinitionId
            );
            const nextRowIndex = fractionalIndex(previousIndex, null);
            previousIndex = nextRowIndex;

            return {
              propertyDefinitionId: currentRow.propertyDefinitionId,
              state: "attached" as const,
              required: localRow?.required ?? currentRow.required,
              inheritToChildren:
                localRow?.inheritToChildren ?? currentRow.inheritToChildren,
              index: nextRowIndex,
            };
          }),
        ];
      },
      [draftRows, localRowsByDefinitionId]
    );

    const handleAddProperty = useCallback(
      async (definition: PropertyDefinitionData) => {
        await persistDraftRows(
          upsertDraftRow(draftRows, {
            propertyDefinitionId: definition.id,
            state: "attached" as const,
            required: false,
            inheritToChildren: true,
            index: createPreviousIndex(currentEffectiveRows),
          })
        );
      },
      [currentEffectiveRows, draftRows, persistDraftRows]
    );

    const handleCreateProperty = useCallback(
      async ({ name, type }: PropertyPickerCreateValues) => {
        if (saveMode === "deferred") {
          const definition: PropertyDefinitionData = {
            id: `draft:${crypto.randomUUID()}`,
            name: name.trim(),
            description: null,
            type,
            options: [],
          };
          setDraftDefinitions((previous) => [...previous, definition]);
          await handleAddProperty(definition);
          return;
        }

        await client.post<{ data: PropertyDefinitionData }>(
          "/collectionPropertyDefinitions.create",
          {
            collectionId,
            name,
            type,
            description: null,
            options: [],
          }
        );
        await loadDefinitions();
        await onUpdate?.();
      },
      [collectionId, handleAddProperty, loadDefinitions, onUpdate, saveMode]
    );

    const handleHideProperty = useCallback(
      async (row: CollectionPropertyDisplayRow) => {
        await persistDraftRows(
          upsertDraftRow(draftRows, {
            state: "excluded" as const,
            propertyDefinitionId: row.propertyDefinitionId,
            required: false,
            inheritToChildren: false,
            index: null,
          })
        );
      },
      [draftRows, persistDraftRows]
    );

    const handleRemoveProperty = useCallback(
      async (row: CollectionPropertyDisplayRow) => {
        if (row.status === "overwritten") {
          await handleHideProperty(row);
          return;
        }

        if (row.propertyDefinitionId.startsWith("draft:")) {
          setDraftDefinitions((previous) =>
            previous.filter(
              (definition) => definition.id !== row.propertyDefinitionId
            )
          );
        }

        await persistDraftRows(
          removeDraftRow(draftRows, row.propertyDefinitionId)
        );
      },
      [draftRows, handleHideProperty, persistDraftRows]
    );

    const handleShowProperty = useCallback(
      async (row: CollectionPropertyDisplayRow) => {
        await persistDraftRows(
          removeDraftRow(draftRows, row.propertyDefinitionId)
        );
      },
      [draftRows, persistDraftRows]
    );

    const handleToggleRequired = useCallback(
      async (row: CollectionPropertyDisplayRow, required: boolean) => {
        const currentLocalRow = localRowsByDefinitionId.get(
          row.propertyDefinitionId
        );
        await persistDraftRows(
          upsertDraftRow(draftRows, {
            propertyDefinitionId: row.propertyDefinitionId,
            state: "attached",
            required,
            inheritToChildren:
              currentLocalRow?.inheritToChildren ?? row.inheritToChildren,
            index: currentLocalRow?.index ?? row.index,
          })
        );
      },
      [draftRows, localRowsByDefinitionId, persistDraftRows]
    );

    const handleToggleInheritToChildren = useCallback(
      async (row: CollectionPropertyDisplayRow, inheritToChildren: boolean) => {
        const currentLocalRow = localRowsByDefinitionId.get(
          row.propertyDefinitionId
        );
        await persistDraftRows(
          upsertDraftRow(draftRows, {
            propertyDefinitionId: row.propertyDefinitionId,
            state: "attached",
            required: currentLocalRow?.required ?? row.required,
            inheritToChildren,
            index: currentLocalRow?.index ?? row.index,
          })
        );
      },
      [draftRows, localRowsByDefinitionId, persistDraftRows]
    );

    const handleMove = useCallback(
      async (row: CollectionPropertyDisplayRow, direction: -1 | 1) => {
        const currentIndex = currentEffectiveRows.findIndex(
          (currentRow) =>
            currentRow.propertyDefinitionId === row.propertyDefinitionId
        );
        const nextIndex = currentIndex + direction;

        if (
          currentIndex < 0 ||
          nextIndex < 0 ||
          nextIndex >= currentEffectiveRows.length
        ) {
          return;
        }

        const reorderedRows = [...currentEffectiveRows];
        const [movedRow] = reorderedRows.splice(currentIndex, 1);
        reorderedRows.splice(nextIndex, 0, movedRow);

        await persistDraftRows(buildReorderedRows(reorderedRows));
      },
      [buildReorderedRows, currentEffectiveRows, persistDraftRows]
    );

    const handleDragEnd = useCallback(
      async (event: DragEndEvent) => {
        const { active, over } = event;

        if (!over || active.id === over.id) {
          return;
        }

        const activeIndex = currentEffectiveRows.findIndex(
          (row) => row.propertyDefinitionId === active.id
        );
        const overIndex = currentEffectiveRows.findIndex(
          (row) => row.propertyDefinitionId === over.id
        );

        if (activeIndex < 0 || overIndex < 0) {
          return;
        }

        await persistDraftRows(
          buildReorderedRows(
            arrayMove(currentEffectiveRows, activeIndex, overIndex)
          )
        );
      },
      [buildReorderedRows, currentEffectiveRows, persistDraftRows]
    );

    const pickerItems = useMemo<PropertyPickerItem[]>(
      () =>
        derivedState.available.map((definition) => ({
          id: definition.id,
          name: definition.name,
          type: definition.type,
        })),
      [derivedState.available]
    );
    const immediateSaveMessage =
      saveMode === "immediate"
        ? isSaving
          ? t("Saving changes…")
          : t("Changes save automatically")
        : null;

    const content = (
      <Surface className={className}>
        {description ? (
          <Description type="secondary">{description}</Description>
        ) : null}
        <Toolbar align="center" justify="space-between" gap={8}>
          <PropertyPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            title={t("Add property")}
            searchPlaceholder={t("Search workspace properties")}
            emptyMessage={t("Search for a property or create a new one.")}
            emptySectionTitle={t("Available properties")}
            items={pickerItems}
            showItemsOnEmpty={showPickerResultsOnEmpty}
            onSelect={(item) => {
              const definition =
                derivedState.available.find(
                  (current) => current.id === item.id
                ) ??
                derivedState.definitionCatalog.find(
                  (current) => current.id === item.id
                );

              if (definition) {
                void handleAddProperty(definition);
              }
            }}
            onCreate={handleCreateProperty}
            disabled={isSaving}
            trigger={
              <Button type="button" disabled={isSaving}>
                {t("Add property")}
              </Button>
            }
          />
          {showManageDefinitionsLink ? (
            <ManageDefinitionsButton
              type="button"
              onClick={() => history.push(settingsPath("properties"))}
            >
              {t("Manage property definitions")}
            </ManageDefinitionsButton>
          ) : null}
        </Toolbar>
        {immediateSaveMessage ? (
          <ImmediateSaveMessage type="secondary" size="small">
            {immediateSaveMessage}
          </ImmediateSaveMessage>
        ) : null}
        {isLoading ? (
          <Text type="secondary">{t("Loading")}…</Text>
        ) : (
          <Sections>
            <Section>
              <SectionTitle type="secondary" weight="bold" size="small">
                {t("Properties in this collection")}
              </SectionTitle>
              {currentEffectiveRows.length === 0 &&
              currentHiddenRows.length === 0 ? (
                <Text type="secondary" size="small">
                  {t("No properties in this collection yet.")}
                </Text>
              ) : null}
              {currentEffectiveRows.length > 0 && reorderMode === "drag" ? (
                <DragPropertyList
                  rows={currentEffectiveRows}
                  localRowsByDefinitionId={localRowsByDefinitionId}
                  isSaving={isSaving}
                  onHide={handleHideProperty}
                  onShow={handleShowProperty}
                  onRemove={handleRemoveProperty}
                  onToggleRequired={handleToggleRequired}
                  onToggleInheritToChildren={handleToggleInheritToChildren}
                  onDragEnd={handleDragEnd}
                />
              ) : null}
              {reorderMode !== "drag" && currentEffectiveRows.length > 0 ? (
                <Rows>
                  {currentEffectiveRows.map((row, index) => (
                    <CollectionPropertyRow
                      key={row.propertyDefinitionId}
                      row={row}
                      localRow={localRowsByDefinitionId.get(
                        row.propertyDefinitionId
                      )}
                      index={index}
                      total={currentEffectiveRows.length}
                      isSaving={isSaving}
                      reorderMode={reorderMode}
                      onMove={handleMove}
                      onHide={handleHideProperty}
                      onShow={handleShowProperty}
                      onRemove={handleRemoveProperty}
                      onToggleRequired={handleToggleRequired}
                      onToggleInheritToChildren={handleToggleInheritToChildren}
                    />
                  ))}
                </Rows>
              ) : null}
              {currentHiddenRows.length > 0 ? (
                <Rows>
                  {currentHiddenRows.map((row) => (
                    <CollectionPropertyRow
                      key={row.propertyDefinitionId}
                      row={row}
                      localRow={localRowsByDefinitionId.get(
                        row.propertyDefinitionId
                      )}
                      index={0}
                      total={currentEffectiveRows.length}
                      isSaving={isSaving}
                      reorderMode={
                        reorderMode === "drag" ? "buttons" : reorderMode
                      }
                      onMove={handleMove}
                      onHide={handleHideProperty}
                      onShow={handleShowProperty}
                      onRemove={handleRemoveProperty}
                      onToggleRequired={handleToggleRequired}
                      onToggleInheritToChildren={handleToggleInheritToChildren}
                    />
                  ))}
                </Rows>
              ) : null}
            </Section>
          </Sections>
        )}
      </Surface>
    );

    if (!collapsible) {
      return content;
    }

    return (
      <Collapsible label={title ?? t("Properties")} defaultOpen={defaultOpen}>
        {content}
      </Collapsible>
    );
  })
);

function DragPropertyList({
  rows,
  localRowsByDefinitionId,
  isSaving,
  onHide,
  onShow,
  onRemove,
  onToggleRequired,
  onToggleInheritToChildren,
  onDragEnd,
}: {
  rows: CollectionPropertyDisplayRow[];
  localRowsByDefinitionId: Map<string, DraftCollectionPropertyDefinitionRow>;
  isSaving: boolean;
  onHide: (row: CollectionPropertyDisplayRow) => void;
  onShow: (row: CollectionPropertyDisplayRow) => void;
  onRemove: (row: CollectionPropertyDisplayRow) => void;
  onToggleRequired: (
    row: CollectionPropertyDisplayRow,
    required: boolean
  ) => void;
  onToggleInheritToChildren: (
    row: CollectionPropertyDisplayRow,
    inheritToChildren: boolean
  ) => void;
  onDragEnd: (event: DragEndEvent) => void | Promise<void>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={(event) => {
        void onDragEnd(event);
      }}
    >
      <SortableContext
        items={rows.map((row) => row.propertyDefinitionId)}
        strategy={verticalListSortingStrategy}
      >
        <Rows>
          {rows.map((row, index) => (
            <SortableCollectionPropertyRow
              key={row.propertyDefinitionId}
              row={row}
              localRow={localRowsByDefinitionId.get(row.propertyDefinitionId)}
              index={index}
              total={rows.length}
              isSaving={isSaving}
              reorderMode="drag"
              onMove={() => undefined}
              onHide={onHide}
              onShow={onShow}
              onRemove={onRemove}
              onToggleRequired={onToggleRequired}
              onToggleInheritToChildren={onToggleInheritToChildren}
            />
          ))}
        </Rows>
      </SortableContext>
    </DndContext>
  );
}

function SortableCollectionPropertyRow(props: CollectionPropertyRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.row.propertyDefinitionId,
    disabled: props.isSaving || props.total <= 1,
  });

  return (
    <CollectionPropertyRow
      {...props}
      ref={setNodeRef}
      dragHandleProps={{
        attributes,
        listeners,
      }}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      isDragging={isDragging}
    />
  );
}

const CollectionPropertyRow = observer(
  forwardRef<
    HTMLDivElement,
    CollectionPropertyRowProps & {
      dragHandleProps?: {
        attributes: DraggableAttributes;
        listeners?: ReturnType<typeof useSortable>["listeners"];
      };
      style?: CSSProperties;
      isDragging?: boolean;
    }
  >(function CollectionPropertyRow(
    {
      row,
      localRow,
      index,
      total,
      isSaving,
      reorderMode,
      onMove,
      onHide,
      onShow,
      onRemove,
      onToggleRequired,
      onToggleInheritToChildren,
      dragHandleProps,
      style,
      isDragging,
    },
    ref
  ) {
    const { t } = useTranslation();
    const isHidden = row.status === "hidden";
    const isDirect = row.status === "direct";
    const isOverwritten = row.status === "overwritten";
    const sourceLabel = isHidden
      ? t("Hidden from {{collection}}", {
          collection: row.sourceCollectionName ?? t("parent collection"),
        })
      : isOverwritten
        ? t("Overwritten")
        : isDirect
          ? t("Added here")
          : t("Inherited from {{collection}}", {
              collection: row.sourceCollectionName ?? t("parent collection"),
            });

    return (
      <PropertyRow
        ref={ref}
        style={style}
        $isDragging={!!isDragging}
        $isHidden={isHidden}
      >
        <RowHeader align="flex-start" justify="space-between" gap={12}>
          <PropertySummary>
            <PropertyNameRow align="center" gap={8}>
              <PropertyName $isHidden={isHidden}>
                {row.definition.name}
              </PropertyName>
              <PropertyTypeBadge>
                {propertyTypeLabel(row.definition.type, t)}
              </PropertyTypeBadge>
            </PropertyNameRow>
            <PropertyMeta type="secondary" size="small">
              {sourceLabel}
            </PropertyMeta>
          </PropertySummary>
          <Actions align="center" gap={6}>
            {!isHidden && reorderMode === "buttons" ? (
              <>
                <Tooltip content={t("Move up")}>
                  <ActionIconButton
                    type="button"
                    onClick={() => onMove(row, -1)}
                    disabled={isSaving || index === 0}
                    aria-label={t("Move up")}
                  >
                    <ArrowUpIcon size={14} />
                  </ActionIconButton>
                </Tooltip>
                <Tooltip content={t("Move down")}>
                  <ActionIconButton
                    type="button"
                    onClick={() => onMove(row, 1)}
                    disabled={isSaving || index === total - 1}
                    aria-label={t("Move down")}
                  >
                    <ArrowDownIcon size={14} />
                  </ActionIconButton>
                </Tooltip>
              </>
            ) : !isHidden ? (
              <Tooltip content={t("Drag to reorder")}>
                <ActionIconButton
                  type="button"
                  $grab
                  $dragging={!!isDragging}
                  disabled={isSaving || total <= 1}
                  aria-label={t("Drag to reorder")}
                  {...dragHandleProps?.attributes}
                  {...dragHandleProps?.listeners}
                >
                  <SortManualIcon size={14} />
                </ActionIconButton>
              </Tooltip>
            ) : null}
            {isHidden ? (
              <Button
                type="button"
                neutral
                onClick={() => onShow(row)}
                disabled={isSaving}
              >
                {t("Show here")}
              </Button>
            ) : row.status === "overwritten" || row.status === "inherited" ? (
              <Button
                type="button"
                neutral
                onClick={() => onHide(row)}
                disabled={isSaving}
              >
                {t("Hide here")}
              </Button>
            ) : isDirect || localRow ? (
              <Button
                type="button"
                neutral
                onClick={() => onRemove(row)}
                disabled={isSaving}
              >
                {t("Remove")}
              </Button>
            ) : null}
          </Actions>
        </RowHeader>
        {!isHidden ? (
          <>
            <SwitchRow align="center" justify="space-between" gap={12}>
              <RequiredLabel align="center" gap={6}>
                <Text type="secondary" size="small">
                  {t("Required")}
                </Text>
                <Tooltip
                  content={t(
                    "Ask people to fill this property when creating or editing documents here."
                  )}
                >
                  <RequiredHelpButton
                    type="button"
                    aria-label={t("About required properties")}
                  >
                    <QuestionMarkIcon size={14} />
                  </RequiredHelpButton>
                </Tooltip>
              </RequiredLabel>
              <Switch
                width={26}
                height={14}
                checked={row.required}
                disabled={isSaving}
                onChange={(checked: boolean) =>
                  void onToggleRequired(row, checked)
                }
              />
            </SwitchRow>
            <SwitchRow align="center" justify="space-between" gap={12}>
              <RequiredLabel align="center" gap={6}>
                <Text type="secondary" size="small">
                  {t("Children inherit")}
                </Text>
                <Tooltip
                  content={t(
                    "Make this property available in subcollections by default."
                  )}
                >
                  <RequiredHelpButton
                    type="button"
                    aria-label={t("About child inheritance")}
                  >
                    <QuestionMarkIcon size={14} />
                  </RequiredHelpButton>
                </Tooltip>
              </RequiredLabel>
              <Switch
                width={26}
                height={14}
                checked={row.inheritToChildren}
                disabled={isSaving}
                onChange={(checked: boolean) =>
                  void onToggleInheritToChildren(row, checked)
                }
              />
            </SwitchRow>
          </>
        ) : null}
      </PropertyRow>
    );
  })
);

const Surface = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Description = styled(Text)`
  margin: 0;
`;

const Toolbar = styled(Flex)`
  flex-wrap: wrap;
`;

const ImmediateSaveMessage = styled(Text)`
  margin-top: -6px;
`;

const ManageDefinitionsButton = styled(NudeButton)`
  color: ${(props) => props.theme.textSecondary};
  text-decoration: underline;
  text-underline-offset: 2px;

  &:hover {
    color: ${(props) => props.theme.text};
  }
`;

const Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled(Text)`
  text-transform: uppercase;
`;

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const PropertyRow = styled.div<{ $isDragging?: boolean; $isHidden?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid
    ${(props) =>
      props.$isHidden ? props.theme.textTertiary : props.theme.divider};
  border-radius: 10px;
  padding: 14px;
  background: ${(props) =>
    props.$isHidden
      ? props.theme.buttonNeutralBackground
      : props.theme.background};
  opacity: ${(props) => {
    if (props.$isDragging) {
      return 0.92;
    }

    return props.$isHidden ? 0.72 : 1;
  }};
  box-shadow: ${(props) =>
    props.$isDragging ? props.theme.menuShadow : "none"};
`;

const RowHeader = styled(Flex)`
  width: 100%;
`;

const SwitchRow = styled(Flex)`
  width: 100%;
  padding-top: 2px;
`;

const RequiredLabel = styled(Flex)`
  min-width: 0;
`;

const PropertySummary = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const PropertyNameRow = styled(Flex)`
  min-width: 0;
  flex-wrap: wrap;
`;

const Actions = styled(Flex)`
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const ActionIconButton = styled(NudeButton)<{
  $grab?: boolean;
  $dragging?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: ${(props) => props.theme.textSecondary};
  background: ${(props) => props.theme.buttonNeutralBackground};
  cursor: ${(props) =>
    props.$dragging ? "grabbing" : props.$grab ? "grab" : "var(--pointer)"};

  &:hover:not(:disabled) {
    color: ${(props) => props.theme.text};
    background: ${(props) => props.theme.sidebarControlHoverBackground};
  }

  &:active:not(:disabled) {
    cursor: ${(props) => (props.$grab ? "grabbing" : "var(--pointer)")};
  }
`;

const RequiredHelpButton = styled(NudeButton)`
  color: ${(props) => props.theme.textTertiary};
`;

const PropertyName = styled.div<{ $isHidden?: boolean }>`
  font-weight: 600;
  min-width: 0;
  color: ${(props) =>
    props.$isHidden ? props.theme.textSecondary : props.theme.text};
`;

const PropertyMeta = styled(Text)`
  margin: 0;
`;

const PropertyTypeBadge = styled.span`
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 11px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${(props) => props.theme.textTertiary};
  background: ${(props) => props.theme.buttonNeutralBackground};
`;
