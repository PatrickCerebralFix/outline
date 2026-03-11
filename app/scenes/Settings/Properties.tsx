import { observer } from "mobx-react";
import { BuildingBlocksIcon, PlusIcon, TrashIcon } from "outline-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { DocumentPropertyType } from "@shared/types";
import type { JSONObject } from "@shared/types";
import { CollectionPropertyDefinitions } from "~/components/Collection/CollectionPropertyDefinitions";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import InputColor from "~/components/InputColor";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import NudeButton from "~/components/NudeButton";
import Scene from "~/components/Scene";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import type {
  PropertyDefinitionOption,
  default as PropertyDefinition,
} from "~/models/PropertyDefinition";
import { client } from "~/utils/ApiClient";

interface PropertyDefinitionDraft {
  id?: string;
  name: string;
  description: string;
  type: DocumentPropertyType;
  options: PropertyDefinitionOption[];
  usageCount?: number;
}

interface CollectionPropertySummary {
  id: string;
  name: string;
  parentCollectionId: string | null;
  index: string;
  propertyCount: number;
}

interface CollectionPropertySummaryItem extends CollectionPropertySummary {
  depth: number;
}

type DefinitionTypeFilter = DocumentPropertyType | "all";

interface CreatePropertyDialogProps {
  typeOptions: Option[];
  onSubmit: (values: {
    name: string;
    description: string;
    type: DocumentPropertyType;
  }) => Promise<void>;
  onCancel: () => void;
}

function supportsOptions(type: DocumentPropertyType) {
  return (
    type === DocumentPropertyType.Select ||
    type === DocumentPropertyType.MultiSelect
  );
}

function isDocumentPropertyType(value: string): value is DocumentPropertyType {
  return Object.values(DocumentPropertyType).some((type) => type === value);
}

function createTypeOptions(t: (key: string) => string): Option[] {
  return [
    {
      type: "item",
      label: t("Text"),
      value: DocumentPropertyType.Text,
    },
    {
      type: "item",
      label: t("Number"),
      value: DocumentPropertyType.Number,
    },
    {
      type: "item",
      label: t("Date"),
      value: DocumentPropertyType.Date,
    },
    {
      type: "item",
      label: t("Select"),
      value: DocumentPropertyType.Select,
    },
    {
      type: "item",
      label: t("Multi-select"),
      value: DocumentPropertyType.MultiSelect,
    },
    {
      type: "item",
      label: t("User"),
      value: DocumentPropertyType.User,
    },
  ];
}

function toDraft(definition: PropertyDefinition): PropertyDefinitionDraft {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description ?? "",
    type: definition.type,
    options: (definition.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
      color: option.color ?? null,
      index: option.index ?? null,
    })),
    usageCount: definition.usageCount,
  };
}

function normalizeDraftForComparison(draft: PropertyDefinitionDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    type: draft.type,
    options: supportsOptions(draft.type)
      ? draft.options
          .map((option, index) => ({
            id: option.id,
            label: option.label.trim(),
            value: option.label.trim(),
            color: option.color?.trim() || null,
            index: `${index}`,
          }))
          .filter((option) => option.label)
      : [],
  };
}

function hasDraftChanges(
  draft: PropertyDefinitionDraft,
  savedDraft?: PropertyDefinitionDraft
) {
  const normalizedDraft = normalizeDraftForComparison(draft);

  if (!savedDraft) {
    return (
      normalizedDraft.name.length > 0 ||
      normalizedDraft.description.length > 0 ||
      normalizedDraft.type !== DocumentPropertyType.Text ||
      normalizedDraft.options.length > 0
    );
  }

  return (
    JSON.stringify(normalizedDraft) !==
    JSON.stringify(normalizeDraftForComparison(savedDraft))
  );
}

function compareCollections(
  a: CollectionPropertySummary,
  b: CollectionPropertySummary
) {
  const indexCompare = a.index.localeCompare(b.index);

  if (indexCompare !== 0) {
    return indexCompare;
  }

  return a.name.localeCompare(b.name);
}

function flattenCollectionTree(
  summaries: CollectionPropertySummary[]
): CollectionPropertySummaryItem[] {
  const itemsByParentId = new Map<string | null, CollectionPropertySummary[]>();
  const knownCollectionIds = new Set(summaries.map((summary) => summary.id));

  for (const summary of summaries) {
    const parentId =
      summary.parentCollectionId &&
      knownCollectionIds.has(summary.parentCollectionId)
        ? summary.parentCollectionId
        : null;
    const current = itemsByParentId.get(parentId) ?? [];
    current.push(summary);
    itemsByParentId.set(parentId, current);
  }

  const ordered: CollectionPropertySummaryItem[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const items = (itemsByParentId.get(parentId) ?? []).sort(
      compareCollections
    );

    for (const item of items) {
      ordered.push({
        ...item,
        depth,
      });
      visit(item.id, depth + 1);
    }
  };

  visit(null, 0);

  return ordered;
}

function CreatePropertyDialog({
  typeOptions,
  onSubmit,
  onCancel,
}: CreatePropertyDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<DocumentPropertyType>(
    DocumentPropertyType.Text
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      toast.error(t("Property name is required"));
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim(),
        type,
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }, [description, name, onSubmit, t, type]);

  return (
    <CreateDialogContent>
      <Input
        label={t("Name")}
        placeholder={t("For example: Owner")}
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        onRequestSubmit={() => void handleSubmit()}
        margin={0}
        autoFocus
      />
      <Input
        label={t("Description")}
        placeholder={t("For example: People responsible for this work")}
        value={description}
        onChange={(ev) => setDescription(ev.target.value)}
        margin={0}
      />
      <InputSelect
        label={t("Type")}
        options={typeOptions}
        value={type}
        onChange={(value) => {
          if (isDocumentPropertyType(value)) {
            setType(value);
          }
        }}
      />
      <CreateDialogActions align="center" justify="flex-end" gap={8}>
        <Button
          type="button"
          neutral
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {t("Cancel")}
        </Button>
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting}
        >
          {isSubmitting ? `${t("Creating")}…` : t("Create property")}
        </Button>
      </CreateDialogActions>
    </CreateDialogContent>
  );
}

/**
 * Workspace-level property definition and collection assignment management.
 *
 * @returns the workspace property settings scene.
 */
function Properties() {
  const { t } = useTranslation();
  const { dialogs, propertyDefinitions } = useStores();
  const [definitions, setDefinitions] = useState<PropertyDefinitionDraft[]>([]);
  const [savedDefinitionsById, setSavedDefinitionsById] = useState<
    Record<string, PropertyDefinitionDraft>
  >({});
  const [collectionSummaries, setCollectionSummaries] = useState<
    CollectionPropertySummary[]
  >([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | undefined
  >();
  const [definitionQuery, setDefinitionQuery] = useState("");
  const [definitionTypeFilter, setDefinitionTypeFilter] =
    useState<DefinitionTypeFilter>("all");
  const [collectionQuery, setCollectionQuery] = useState("");
  const [hideEmptyCollections, setHideEmptyCollections] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCollections, setIsLoadingCollections] = useState(true);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [collectionDetailVersion, setCollectionDetailVersion] = useState(0);
  const [recentDefinitionId, setRecentDefinitionId] = useState<string>();

  const typeOptions = useMemo<Option[]>(() => createTypeOptions(t), [t]);

  const definitionTypeFilterOptions = useMemo<Option[]>(
    () => [
      {
        type: "item",
        label: t("All types"),
        value: "all",
      },
      ...typeOptions,
    ],
    [t, typeOptions]
  );

  const loadDefinitions = useCallback(
    async (pinnedDefinitionId?: string) => {
      setIsLoading(true);

      try {
        const targetDefinitionId = pinnedDefinitionId ?? recentDefinitionId;
        const loaded = await propertyDefinitions.fetchDefinitions();
        const loadedDrafts = loaded
          .filter((definition) => !definition.deletedAt)
          .sort((a, b) => {
            if (a.id === targetDefinitionId) {
              return -1;
            }

            if (b.id === targetDefinitionId) {
              return 1;
            }

            return a.name.localeCompare(b.name);
          })
          .map(toDraft);

        setDefinitions(loadedDrafts);
        setSavedDefinitionsById(
          loadedDrafts.reduce<Record<string, PropertyDefinitionDraft>>(
            (result, draft) => {
              if (draft.id) {
                result[draft.id] = draft;
              }

              return result;
            },
            {}
          )
        );
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [propertyDefinitions, recentDefinitionId]
  );

  const loadCollectionSummaries = useCallback(async () => {
    setIsLoadingCollections(true);

    try {
      const res = await client.post<{ data: CollectionPropertySummary[] }>(
        "/collectionPropertyDefinitions.workspaceList",
        {}
      );
      setCollectionSummaries(res.data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsLoadingCollections(false);
    }
  }, []);

  useEffect(() => {
    void loadDefinitions();
    void loadCollectionSummaries();
  }, [loadCollectionSummaries, loadDefinitions]);

  const orderedCollections = useMemo(
    () => flattenCollectionTree(collectionSummaries),
    [collectionSummaries]
  );

  const visibleCollections = useMemo(() => {
    const normalizedQuery = collectionQuery.trim().toLocaleLowerCase();

    return orderedCollections.filter((collection) => {
      if (hideEmptyCollections && collection.propertyCount === 0) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return collection.name.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [collectionQuery, hideEmptyCollections, orderedCollections]);

  useEffect(() => {
    if (
      selectedCollectionId &&
      visibleCollections.some(
        (collection) => collection.id === selectedCollectionId
      )
    ) {
      return;
    }

    setSelectedCollectionId(visibleCollections[0]?.id);
  }, [selectedCollectionId, visibleCollections]);

  const selectedCollection = useMemo(
    () =>
      orderedCollections.find(
        (collection) => collection.id === selectedCollectionId
      ),
    [orderedCollections, selectedCollectionId]
  );

  const visibleDefinitions = useMemo(() => {
    const normalizedQuery = definitionQuery.trim().toLocaleLowerCase();

    return definitions.filter((definition) => {
      const savedDraft = definition.id
        ? savedDefinitionsById[definition.id]
        : undefined;
      const isDirty = hasDraftChanges(definition, savedDraft);

      if (isDirty) {
        return true;
      }

      if (
        definitionTypeFilter !== "all" &&
        definition.type !== definitionTypeFilter
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return definition.name.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [
    definitionQuery,
    definitionTypeFilter,
    definitions,
    savedDefinitionsById,
  ]);

  const setDefinitionAt = useCallback(
    (
      index: number,
      updater: (definition: PropertyDefinitionDraft) => PropertyDefinitionDraft
    ) => {
      setDefinitions((current) =>
        current.map((definition, currentIndex) =>
          currentIndex === index ? updater(definition) : definition
        )
      );
    },
    []
  );

  const normalizeOptions = useCallback((draft: PropertyDefinitionDraft) => {
    if (!supportsOptions(draft.type)) {
      return [];
    }

    const normalized: JSONObject[] = [];

    draft.options.forEach((option, index) => {
      const label = option.label.trim();

      if (!label) {
        return;
      }

      normalized.push({
        ...(option.id ? { id: option.id } : {}),
        label,
        value: label,
        color: option.color?.trim() || null,
        index: `${index}`,
      });
    });

    return normalized;
  }, []);

  const bumpCollectionDetailVersion = useCallback(() => {
    setCollectionDetailVersion((current) => current + 1);
  }, []);

  const handleSaveDefinition = useCallback(
    async (index: number) => {
      const draft = definitions[index];

      if (!draft?.id) {
        return;
      }

      const name = draft.name.trim();
      if (!name) {
        toast.error(t("Property name is required"));
        return;
      }

      const description = draft.description.trim();
      const options = normalizeOptions(draft);
      const savingId = draft.id;
      setSavingIds((current) => [...current, savingId]);

      try {
        await client.post("/propertyDefinitions.update", {
          id: draft.id,
          name,
          description: description || null,
          options,
        });

        await loadDefinitions();
        bumpCollectionDetailVersion();
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setSavingIds((current) =>
          current.filter((currentId) => currentId !== savingId)
        );
      }
    },
    [
      bumpCollectionDetailVersion,
      definitions,
      loadDefinitions,
      normalizeOptions,
      t,
    ]
  );

  const handleDeleteDefinition = useCallback(
    async (index: number) => {
      const draft = definitions[index];

      if (!draft?.id) {
        return;
      }

      const model = propertyDefinitions.get(draft.id);
      if (!model) {
        return;
      }

      setDeletingIds((current) => [...current, draft.id!]);

      try {
        await propertyDefinitions.delete(model);
        setDefinitions((current) =>
          current.filter((_, currentIndex) => currentIndex !== index)
        );
        await loadCollectionSummaries();
        bumpCollectionDetailVersion();
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setDeletingIds((current) => current.filter((id) => id !== draft.id));
      }
    },
    [
      bumpCollectionDetailVersion,
      definitions,
      loadCollectionSummaries,
      propertyDefinitions,
    ]
  );

  const handleCreateDefinition = useCallback(
    async ({
      name,
      description,
      type,
    }: {
      name: string;
      description: string;
      type: DocumentPropertyType;
    }) => {
      const res = await client.post<{ data: { id: string } }>(
        "/propertyDefinitions.create",
        {
          name,
          description: description || null,
          type,
          options: [],
        }
      );

      setRecentDefinitionId(res.data.id);
      setDefinitionQuery("");
      setDefinitionTypeFilter("all");
      await loadDefinitions(res.data.id);
      dialogs.closeAllModals();
    },
    [dialogs, loadDefinitions]
  );

  const handleOpenCreateDefinitionModal = useCallback(() => {
    dialogs.openModal({
      title: t("New property"),
      content: (
        <CreatePropertyDialog
          typeOptions={typeOptions}
          onSubmit={async (values) => {
            await handleCreateDefinition(values);
          }}
          onCancel={dialogs.closeAllModals}
        />
      ),
    });
  }, [dialogs, handleCreateDefinition, t, typeOptions]);

  return (
    <Scene title={t("Properties")} icon={<BuildingBlocksIcon />}>
      <PageHeader>
        <div>
          <Heading>{t("Properties")}</Heading>
          <Text as="p" type="secondary">
            {t(
              "Manage workspace property definitions on the left, then choose where collections use them on the right."
            )}
          </Text>
        </div>
      </PageHeader>

      <PageGrid>
        <PanelCard>
          <PanelHeader>
            <div>
              <PanelTitle>{t("Property definitions")}</PanelTitle>
              <PanelDescription type="secondary" size="small">
                {t(
                  "Create and edit reusable properties here. Collections decide whether to use them."
                )}
              </PanelDescription>
            </div>
            <Button onClick={handleOpenCreateDefinitionModal} type="button">
              <PlusIcon size={16} /> {t("New property")}
            </Button>
          </PanelHeader>

          <DefinitionsToolbar>
            <Input
              type="search"
              label={t("Search properties")}
              labelHidden
              placeholder={t("Search properties")}
              value={definitionQuery}
              onChange={(event) => setDefinitionQuery(event.target.value)}
              margin={0}
              flex
            />
            <DefinitionFilterSelect
              label={t("Filter by type")}
              hideLabel
              value={definitionTypeFilter}
              onChange={(value) => {
                if (value === "all" || isDocumentPropertyType(value)) {
                  setDefinitionTypeFilter(value);
                }
              }}
              options={definitionTypeFilterOptions}
            />
          </DefinitionsToolbar>

          {isLoading ? (
            <Text type="secondary">{t("Loading")}…</Text>
          ) : definitions.length === 0 ? (
            <EmptyState type="secondary">
              {t("No workspace properties created yet.")}
            </EmptyState>
          ) : visibleDefinitions.length === 0 ? (
            <EmptyState type="secondary">
              {t("No properties match those filters.")}
            </EmptyState>
          ) : (
            <DefinitionsList>
              {visibleDefinitions.map((definition) => {
                if (!definition.id) {
                  return null;
                }

                const index = definitions.findIndex(
                  (currentDefinition) => currentDefinition.id === definition.id
                );

                if (index === -1) {
                  return null;
                }

                const rowId = definition.id;
                const isSaving = savingIds.includes(rowId);
                const isDeleting = deletingIds.includes(definition.id);
                const isDirty = hasDraftChanges(
                  definition,
                  savedDefinitionsById[definition.id]
                );
                const canSave = !isSaving && !isDeleting && isDirty;

                return (
                  <DefinitionCard key={rowId}>
                    <DefinitionTopRow align="flex-start" gap={12}>
                      <Input
                        label={t("Name")}
                        value={definition.name}
                        onChange={(ev) =>
                          setDefinitionAt(index, (current) => ({
                            ...current,
                            name: ev.target.value,
                          }))
                        }
                        flex
                        margin={0}
                      />
                      <TypeSelect
                        label={t("Type")}
                        value={definition.type}
                        onChange={(value) => {
                          if (!isDocumentPropertyType(value)) {
                            return;
                          }

                          setDefinitionAt(index, (current) => ({
                            ...current,
                            type: value,
                            options: supportsOptions(value)
                              ? current.options
                              : [],
                          }));
                        }}
                        options={typeOptions}
                        disabled={!!definition.id}
                      />
                    </DefinitionTopRow>
                    <Input
                      label={t("Description")}
                      value={definition.description}
                      onChange={(ev) =>
                        setDefinitionAt(index, (current) => ({
                          ...current,
                          description: ev.target.value,
                        }))
                      }
                      margin={0}
                    />
                    <MetaRow align="center" justify="space-between" gap={8}>
                      <Text type="secondary" size="small">
                        {definition.usageCount
                          ? t("Added to {{ count }} collections", {
                              count: definition.usageCount,
                            })
                          : t("Not added to any collections yet")}
                      </Text>
                      <DefinitionActions align="center" gap={8}>
                        <Button
                          type="button"
                          neutral
                          onClick={() => void handleSaveDefinition(index)}
                          disabled={!canSave}
                        >
                          {isSaving
                            ? `${t("Saving")}…`
                            : !isDirty && definition.id
                              ? t("Saved")
                              : t("Save")}
                        </Button>
                        <NudeButton
                          type="button"
                          onClick={() => void handleDeleteDefinition(index)}
                          disabled={isSaving || isDeleting}
                          aria-label={t("Delete property")}
                        >
                          <TrashIcon size={18} />
                        </NudeButton>
                      </DefinitionActions>
                    </MetaRow>
                    {supportsOptions(definition.type) && (
                      <OptionsSection>
                        <Text type="secondary" size="small">
                          {t("Options")}
                        </Text>
                        {definition.options.map((option, optionIndex) => (
                          <OptionGrid key={option.id ?? optionIndex}>
                            <Input
                              label={t("Label")}
                              value={option.label}
                              onChange={(ev) =>
                                setDefinitionAt(index, (current) => ({
                                  ...current,
                                  options: current.options.map(
                                    (currentOption, currentOptionIndex) =>
                                      currentOptionIndex === optionIndex
                                        ? {
                                            ...currentOption,
                                            label: ev.target.value,
                                            value: ev.target.value,
                                          }
                                        : currentOption
                                  ),
                                }))
                              }
                              flex
                              margin={0}
                            />
                            <OptionColorInput
                              label={t("Color")}
                              value={option.color ?? undefined}
                              onChange={(color) =>
                                setDefinitionAt(index, (current) => ({
                                  ...current,
                                  options: current.options.map(
                                    (currentOption, currentOptionIndex) =>
                                      currentOptionIndex === optionIndex
                                        ? { ...currentOption, color }
                                        : currentOption
                                  ),
                                }))
                              }
                              margin={0}
                            />
                            <RemoveOptionButton
                              type="button"
                              onClick={() =>
                                setDefinitionAt(index, (current) => ({
                                  ...current,
                                  options: current.options.filter(
                                    (_, currentOptionIndex) =>
                                      currentOptionIndex !== optionIndex
                                  ),
                                }))
                              }
                              aria-label={t("Remove option")}
                            >
                              <TrashIcon size={18} />
                            </RemoveOptionButton>
                          </OptionGrid>
                        ))}
                        <Button
                          type="button"
                          neutral
                          onClick={() =>
                            setDefinitionAt(index, (current) => ({
                              ...current,
                              options: [
                                ...current.options,
                                {
                                  label: "",
                                  value: "",
                                  color: null,
                                  index: `${current.options.length}`,
                                },
                              ],
                            }))
                          }
                        >
                          {t("Add option")}
                        </Button>
                      </OptionsSection>
                    )}
                  </DefinitionCard>
                );
              })}
            </DefinitionsList>
          )}
        </PanelCard>

        <RightColumn>
          <PanelCard>
            <PanelHeader>
              <div>
                <PanelTitle>{t("Collections")}</PanelTitle>
                <PanelDescription type="secondary" size="small">
                  {t(
                    "Pick a collection to add properties, adjust required fields, and set the order people see."
                  )}
                </PanelDescription>
              </div>
            </PanelHeader>

            <CollectionToolbar>
              <Input
                type="search"
                label={t("Search collections")}
                labelHidden
                placeholder={t("Search collections")}
                value={collectionQuery}
                onChange={(event) => setCollectionQuery(event.target.value)}
                margin={0}
                flex
              />
              <InlineSwitchRow align="center" gap={8}>
                <Text type="secondary" size="small">
                  {t("Hide empty")}
                </Text>
                <Switch
                  width={28}
                  height={16}
                  checked={hideEmptyCollections}
                  onChange={setHideEmptyCollections}
                />
              </InlineSwitchRow>
            </CollectionToolbar>

            {isLoadingCollections ? (
              <Text type="secondary">{t("Loading")}…</Text>
            ) : visibleCollections.length === 0 ? (
              <EmptyState type="secondary">
                {t("No collections match those filters.")}
              </EmptyState>
            ) : (
              <CollectionList>
                {visibleCollections.map((collection) => (
                  <CollectionListButton
                    key={collection.id}
                    type="button"
                    $selected={collection.id === selectedCollectionId}
                    $depth={collection.depth}
                    onClick={() => setSelectedCollectionId(collection.id)}
                  >
                    <CollectionListName>{collection.name}</CollectionListName>
                    <CollectionCount>
                      {t("{{count}} properties", {
                        count: collection.propertyCount,
                      })}
                    </CollectionCount>
                  </CollectionListButton>
                ))}
              </CollectionList>
            )}
          </PanelCard>

          <PanelCard>
            <PanelHeader>
              <div>
                <PanelTitle>
                  {selectedCollection
                    ? t("{{collection}} properties", {
                        collection: selectedCollection.name,
                      })
                    : t("Collection properties")}
                </PanelTitle>
                <PanelDescription type="secondary" size="small">
                  {selectedCollection
                    ? t(
                        "This is where you decide which workspace properties this collection uses."
                      )
                    : t("Choose a collection above to manage its properties.")}
                </PanelDescription>
              </div>
            </PanelHeader>

            {selectedCollection ? (
              <CollectionPropertyDefinitions
                key={`${selectedCollection.id}-${collectionDetailVersion}`}
                collectionId={selectedCollection.id}
                collapsible={false}
                showManageDefinitionsLink={false}
                reorderMode="drag"
                showPickerResultsOnEmpty
                onUpdate={loadCollectionSummaries}
              />
            ) : (
              <EmptyState type="secondary">
                {t("Select a collection to manage its properties.")}
              </EmptyState>
            )}
          </PanelCard>
        </RightColumn>
      </PageGrid>
    </Scene>
  );
}

const PageHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;

  @media (max-width: 900px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const PageGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 20px;
  align-items: start;

  @media (max-width: 1100px) {
    grid-template-columns: 1fr;
  }
`;

const RightColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const PanelCard = styled.section`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 12px;
  background: ${(props) => props.theme.background};
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
`;

const PanelDescription = styled(Text)`
  margin-top: 4px;
`;

const DefinitionsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const DefinitionsToolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 12px;
  align-items: end;

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

const DefinitionCard = styled.div`
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const DefinitionTopRow = styled(Flex)`
  width: 100%;
  flex-wrap: wrap;

  > * {
    min-width: 0;
  }

  @media (max-width: 900px) {
    flex-direction: column;
  }
`;

const TypeSelect = styled(InputSelect)`
  width: 220px;
  min-width: 160px;
  max-width: 100%;

  @media (max-width: 900px) {
    width: 100%;
  }
`;

const DefinitionFilterSelect = styled(InputSelect)`
  width: 100%;
`;

const MetaRow = styled(Flex)`
  width: 100%;
  flex-wrap: wrap;
`;

const DefinitionActions = styled(Flex)`
  flex-shrink: 0;
`;

const OptionsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const OptionGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 132px auto;
  gap: 8px;
  align-items: end;

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

const OptionColorInput = styled(InputColor)`
  min-width: 0;
`;

const CreateDialogContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
`;

const CreateDialogActions = styled(Flex)`
  width: 100%;
`;

const RemoveOptionButton = styled(NudeButton)`
  align-self: end;
  margin-bottom: 4px;
`;

const CollectionToolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

const InlineSwitchRow = styled(Flex)`
  justify-self: end;

  @media (max-width: 700px) {
    justify-self: start;
  }
`;

const CollectionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 4px;
`;

const CollectionListButton = styled.button<{
  $selected: boolean;
  $depth: number;
}>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 10px 12px;
  padding-left: ${(props) => 12 + props.$depth * 18}px;
  border: 0;
  border-radius: 10px;
  background: ${(props) =>
    props.$selected ? props.theme.sidebarActiveBackground : "transparent"};
  color: inherit;
  cursor: var(--pointer);
  text-align: left;

  &:hover {
    background: ${(props) =>
      props.$selected
        ? props.theme.sidebarActiveBackground
        : props.theme.sidebarControlHoverBackground};
  }
`;

const CollectionListName = styled.span`
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CollectionCount = styled.span`
  color: ${(props) => props.theme.textSecondary};
  font-size: 12px;
  white-space: nowrap;
`;

const EmptyState = styled(Text)`
  margin: 0;
`;

export default observer(Properties);
