import { observer } from "mobx-react";
import { TrashIcon } from "outline-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { DocumentPropertyType } from "@shared/types";
import type { JSONObject } from "@shared/types";
import Button from "~/components/Button";
import { Collapsible } from "~/components/Collapsible";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import InputColor from "~/components/InputColor";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
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
  required: boolean;
  options: PropertyDefinitionOption[];
}

function createDraft(): PropertyDefinitionDraft {
  return {
    name: "",
    description: "",
    type: DocumentPropertyType.Text,
    required: false,
    options: [],
  };
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

function toDraft(definition: PropertyDefinition): PropertyDefinitionDraft {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description ?? "",
    type: definition.type,
    required: definition.required,
    options: (definition.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
      color: option.color ?? null,
      index: option.index ?? null,
    })),
  };
}

export const CollectionPropertyDefinitions = observer(
  function CollectionPropertyDefinitions({
    collectionId,
  }: {
    collectionId: string;
  }) {
    const { t } = useTranslation();
    const { propertyDefinitions } = useStores();
    const [definitions, setDefinitions] = useState<PropertyDefinitionDraft[]>(
      []
    );
    const [isLoading, setIsLoading] = useState(true);
    const [savingIds, setSavingIds] = useState<string[]>([]);
    const [deletingIds, setDeletingIds] = useState<string[]>([]);

    const typeOptions = useMemo<Option[]>(
      () => [
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
      ],
      [t]
    );

    const loadDefinitions = useCallback(async () => {
      setIsLoading(true);

      try {
        const loaded = await propertyDefinitions.fetchDefinitions(collectionId);
        const forCollection = loaded
          .filter((definition) => definition.collectionId === collectionId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(toDraft);
        setDefinitions(forCollection);
      } catch (err) {
        toast.error(err.message);
      } finally {
        setIsLoading(false);
      }
    }, [collectionId, propertyDefinitions]);

    useEffect(() => {
      void loadDefinitions();
    }, [loadDefinitions]);

    const setDefinitionAt = useCallback(
      (
        index: number,
        updater: (
          definition: PropertyDefinitionDraft
        ) => PropertyDefinitionDraft
      ) => {
        setDefinitions((current) =>
          current.map((definition, currentIndex) =>
            currentIndex === index ? updater(definition) : definition
          )
        );
      },
      []
    );

    const handleAddDefinition = useCallback(() => {
      setDefinitions((current) => [...current, createDraft()]);
    }, []);

    const handleRemoveDefinition = useCallback(
      async (index: number) => {
        const definition = definitions[index];

        if (!definition) {
          return;
        }

        if (!definition.id) {
          setDefinitions((current) =>
            current.filter((_, currentIndex) => currentIndex !== index)
          );
          return;
        }

        const model = propertyDefinitions.get(definition.id);

        if (!model) {
          return;
        }

        setDeletingIds((current) => [...current, definition.id!]);

        try {
          await propertyDefinitions.delete(model);
          setDefinitions((current) =>
            current.filter((_, currentIndex) => currentIndex !== index)
          );
        } catch (err) {
          toast.error(err.message);
        } finally {
          setDeletingIds((current) =>
            current.filter((itemId) => itemId !== definition.id)
          );
        }
      },
      [definitions, propertyDefinitions]
    );

    const normalizeOptions = useCallback(
      (draft: PropertyDefinitionDraft): JSONObject[] => {
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
      },
      []
    );

    const handleSaveDefinition = useCallback(
      async (index: number) => {
        const draft = definitions[index];

        if (!draft) {
          return;
        }

        const name = draft.name.trim();
        if (!name) {
          toast.error(t("Property name is required"));
          return;
        }

        const description = draft.description.trim();
        const options = normalizeOptions(draft);
        const savingId = draft.id ?? `new-${index}`;
        setSavingIds((current) => [...current, savingId]);

        try {
          if (draft.id) {
            await client.post("/propertyDefinitions.update", {
              id: draft.id,
              name,
              description: description || null,
              required: draft.required,
              options,
            });
          } else {
            await client.post("/propertyDefinitions.create", {
              collectionId,
              name,
              description: description || null,
              type: draft.type,
              required: draft.required,
              options,
            });
          }

          await loadDefinitions();
        } catch (err) {
          toast.error(err.message);
        } finally {
          setSavingIds((current) =>
            current.filter((currentId) => currentId !== savingId)
          );
        }
      },
      [collectionId, definitions, loadDefinitions, normalizeOptions, t]
    );

    return (
      <Collapsible label={t("Document properties")} defaultOpen>
        <Description type="secondary">
          {t("Define structured fields that can be added to documents.")}
        </Description>
        {isLoading ? (
          <Text type="secondary">{t("Loading")}…</Text>
        ) : (
          <DefinitionsList>
            {definitions.map((definition, index) => {
              const rowId = definition.id ?? `new-${index}`;
              const isSaving = savingIds.includes(rowId);
              const isDeleting =
                !!definition.id && deletingIds.includes(definition.id);

              return (
                <DefinitionCard key={rowId}>
                  <Row>
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
                  </Row>
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
                  <RequiredSwitch
                    width={26}
                    height={14}
                    label={t("Required")}
                    checked={definition.required}
                    onChange={(checked: boolean) =>
                      setDefinitionAt(index, (current) => ({
                        ...current,
                        required: checked,
                      }))
                    }
                  />
                  {supportsOptions(definition.type) && (
                    <OptionsSection>
                      <Text type="secondary">{t("Options")}</Text>
                      {definition.options.map((option, optionIndex) => (
                        <OptionRow key={option.id ?? optionIndex}>
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
                          />
                          <InputColor
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
                          />
                          <IconButton
                            type="button"
                            icon={<TrashIcon />}
                            neutral
                            onClick={() =>
                              setDefinitionAt(index, (current) => ({
                                ...current,
                                options: current.options.filter(
                                  (_, currentOptionIndex) =>
                                    currentOptionIndex !== optionIndex
                                ),
                              }))
                            }
                          />
                        </OptionRow>
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
                  <Actions>
                    <Button
                      type="button"
                      neutral
                      onClick={() => void handleRemoveDefinition(index)}
                      disabled={isDeleting || isSaving}
                    >
                      {isDeleting ? `${t("Deleting")}…` : t("Delete")}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleSaveDefinition(index)}
                      disabled={isSaving || isDeleting}
                    >
                      {isSaving ? `${t("Saving")}…` : t("Save")}
                    </Button>
                  </Actions>
                </DefinitionCard>
              );
            })}
          </DefinitionsList>
        )}
        <AddButton type="button" neutral onClick={handleAddDefinition}>
          {t("Add property")}
        </AddButton>
      </Collapsible>
    );
  }
);

const Description = styled(Text)`
  margin-bottom: 12px;
`;

const DefinitionsList = styled(Flex)`
  flex-direction: column;
  gap: 12px;
`;

const DefinitionCard = styled.div`
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Row = styled.div`
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) 220px;
`;

const TypeSelect = styled(InputSelect)`
  margin: 0;
`;

const RequiredSwitch = styled(Switch)`
  font-size: 14px;
`;

const OptionsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const OptionRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px 44px;
  gap: 8px;
  align-items: end;
`;

const IconButton = styled(Button)`
  min-width: 36px;
  padding-left: 0;
  padding-right: 0;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const AddButton = styled(Button)`
  margin-top: 12px;
`;
