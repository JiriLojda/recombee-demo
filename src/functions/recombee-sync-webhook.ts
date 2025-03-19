import { SignatureHelper, WebhookItemNotification, WebhookNotification, WebhookResponse } from "@kontent-ai/webhook-helper";
import { Handler } from "@netlify/functions";

import { RecombeeConfiguration } from "./model/configuration-model";
import KontentClient from "./model/kontent-client";
import RecombeeClient from "./model/recombee-client";

const signatureHeaderName = "x-kontent-ai-signature";

const { RECOMBEE_API_KEY, KONTENT_SECRET } = process.env;

export const handler: Handler = async (event) => {
  // Only receiving POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (!RECOMBEE_API_KEY || !KONTENT_SECRET) {
    return { statusCode: 400, body: "Missing Netlify environment variable, please check the documentation" };
  }

  const typesToWatch = event.queryStringParameters?.types?.split(",");
  const languagesToWatch = event.queryStringParameters?.languages?.split(",");

  // Empty body
  if (!event.body || !typesToWatch || !languagesToWatch) {
    return { statusCode: 400, body: "Missing Data" };
  }

  const recombeeConfig: RecombeeConfiguration = {
    database: process.env.RECOMBEE_API_ID || "",
    key: RECOMBEE_API_KEY,
    region: process.env.RECOMBEE_REGION,
    baseUri: process.env.RECOMBEE_BASE_URI,
  };

  const signitureHelper = new SignatureHelper();
  // Verify that the request is comming from Kontent.ai and not from somewhere else
  if (
    !event.headers[signatureHeaderName]
    || !signitureHelper.isValidSignatureFromString(
      event.body,
      KONTENT_SECRET,
      event.headers[signatureHeaderName].toString(),
    )
  ) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  const webhook: WebhookResponse = JSON.parse(event.body);

  const recombeeClient = new RecombeeClient(recombeeConfig);

  await Promise.all(
    webhook.notifications
    .filter((notification: WebhookNotification) => notification.message.object_type === "content_item")
    .filter((notification: WebhookItemNotification) => typesToWatch.includes(notification.data.system.type) && languagesToWatch.includes(notification.data.system.language))
    .map(processItemNotification(recombeeClient)),
  );
  
  return {
    statusCode: 200,
    body: "success",
  };
};

const processItemNotification = (recombeeClient: RecombeeClient) => async (
  notification: WebhookItemNotification
) => {
  switch (notification.message.action) {
    // publish webhook
    case "published": {
      try {
        const kontentClient = new KontentClient({
          environmentId: notification.message.environment_id,
          contentType: notification.data.system.type,
          language: notification.data.system.language,
        });

        const contentItem = await kontentClient.getContentForCodename(notification.data.system.codename);
        if (contentItem) {
          await recombeeClient.importContent([contentItem]);
        }
      } catch (err) {
        return {
          statusCode: 520,
          body: JSON.stringify({ message: err }),
        };
      }
      break;
    }
    // unpublish webhook
    case "unpublished": {
      try {
        await recombeeClient.deleteContent([`${notification.data.system.id}_${notification.data.system.language}`]);
      } catch (err) {
        return {
          statusCode: 520,
          body: JSON.stringify({ message: err }),
        };
      }
      break;
    }
  }
};