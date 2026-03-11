import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import type { NavigationNode } from "@shared/types";
import { CollectionPermission } from "@shared/types";
import type Collection from "~/models/Collection";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Flex from "~/components/Flex";
import useStores from "~/hooks/useStores";
import { AuthorizationError } from "~/utils/errors";

type Props = {
  /** The navigation node to move, must represent a document. */
  item: NavigationNode;
  /** The collection to move the document to. */
  collection: Collection;
  /** The parent document to move the document under. */
  parentDocumentId?: string | null;
  /** The index to move the document to. */
  index?: number | null;
};

function ConfirmMoveDialog({ collection, item, ...rest }: Props) {
  const { documents, dialogs, collections } = useStores();
  const { t } = useTranslation();
  const prevCollection = collections.get(item.collectionId!);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [droppedPropertyNames, setDroppedPropertyNames] = useState<string[]>([]);
  const [attachCandidates, setAttachCandidates] = useState<string[]>([]);
  const [canAttachToDestination, setCanAttachToDestination] = useState(false);
  const [attachMissingProperties, setAttachMissingProperties] = useState(true);
  const accessMapping: Record<Partial<CollectionPermission> | "null", string> = {
    [CollectionPermission.Admin]: t("manage access"),
    [CollectionPermission.ReadWrite]: t("view and edit access"),
    [CollectionPermission.Read]: t("view only access"),
    null: t("no access"),
  };

  useEffect(() => {
    let cancelled = false;

    const loadPreview = async () => {
      setLoadingPreview(true);

      try {
        const preview = await documents.movePreview({
          documentId: item.id,
          collectionId: collection.id,
          parentDocumentId: rest.parentDocumentId,
        });

        if (cancelled) {
          return;
        }

        setDroppedPropertyNames(preview.droppedPropertyNames);
        setAttachCandidates(preview.attachCandidates);
        setCanAttachToDestination(preview.canAttachToDestination);
        setAttachMissingProperties(preview.canAttachToDestination);
      } catch (err) {
        if (!cancelled) {
          toast.error((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoadingPreview(false);
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [collection.id, documents, item.id, rest.parentDocumentId]);

  const handleSubmit = async () => {
    try {
      await documents.move({
        documentId: item.id,
        collectionId: collection.id,
        ...rest,
        confirmPropertyDrops: true,
        attachPropertyDefinitionIds:
          attachMissingProperties && canAttachToDestination
            ? attachCandidates
            : undefined,
      });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        toast.error(
          t(
            "You do not have permission to move {{ documentName }} to the {{ collectionName }} collection",
            {
              documentName: item.title,
              collectionName: collection.name,
            }
          )
        );
      } else {
        toast.error((err as Error).message);
      }
    } finally {
      dialogs.closeAllModals();
    }
  };

  return (
    <ConfirmationDialog
      onSubmit={handleSubmit}
      submitText={t("Move document")}
      savingText={loadingPreview ? `${t("Loading")}…` : `${t("Moving")}…`}
      disabled={loadingPreview}
    >
      <>
        <Trans
          defaults="Moving the document <em>{{ title }}</em> to the {{ newCollectionName }} collection will change permission for all workspace members from <em>{{ prevPermission }}</em> to <em>{{ newPermission }}</em>."
          values={{
            title: item.title,
            prevCollectionName: prevCollection?.name,
            newCollectionName: collection.name,
            prevPermission: accessMapping[prevCollection?.permission || "null"],
            newPermission: accessMapping[collection.permission || "null"],
          }}
          components={{
            em: <strong />,
          }}
        />
        {droppedPropertyNames.length > 0 && (
          <>
            <Spacer />
            <DetailText>
              {t("This move will remove:")} {droppedPropertyNames.join(", ")}
            </DetailText>
            {canAttachToDestination && attachCandidates.length > 0 && (
              <CheckboxRow align="center" gap={8}>
                <input
                  id="confirm-attach-missing-properties"
                  type="checkbox"
                  checked={attachMissingProperties}
                  onChange={(ev) =>
                    setAttachMissingProperties(ev.target.checked)
                  }
                />
                <label htmlFor="confirm-attach-missing-properties">
                  {t("Also add those properties to the destination collection")}
                </label>
              </CheckboxRow>
            )}
          </>
        )}
      </>
    </ConfirmationDialog>
  );
}

const Spacer = styled.br``;

const DetailText = styled.span`
  display: block;
  margin-top: 8px;
`;

const CheckboxRow = styled(Flex)`
  font-size: 13px;
  margin-top: 8px;
`;

export default observer(ConfirmMoveDialog);
