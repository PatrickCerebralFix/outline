import { reconcileDocumentPropertyOptions } from "@server/commands/documentPropertyUpdater";
import { BaseTask, TaskPriority } from "./base/BaseTask";

type Props = {
  propertyDefinitionId: string;
  userId: string;
};

/**
 * Reconciles stored document property values after a selectable definition's
 * options have changed.
 */
export default class ReconcileDocumentPropertyOptionsTask extends BaseTask<Props> {
  public async perform(props: Props) {
    await reconcileDocumentPropertyOptions({
      propertyDefinitionId: props.propertyDefinitionId,
      userId: props.userId,
    });
  }

  public get options() {
    return {
      priority: TaskPriority.Background,
      attempts: 3,
      backoff: {
        type: "exponential" as const,
        delay: 30 * 1000,
      },
    };
  }
}
