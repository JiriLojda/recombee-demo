import { Elements, ElementType, IContentItem, IGenericElement } from "@kontent-ai/delivery-sdk";
import * as Recombee from "recombee-api-client";

import { notNull } from "../../typeguards";
import { RecombeeConfiguration } from "./configuration-model";

type RecombeeDataType = "int" | "double" | "string" | "boolean" | "timestamp" | "set" | "image" | "imageList";

export default class RecombeeClient {
  config: RecombeeConfiguration;
  client: Recombee.ApiClient;

  private datatypeMap: Map<string, RecombeeDataType>;

  constructor(config: RecombeeConfiguration) {
    this.config = config;
    this.client = new Recombee.ApiClient(config.database, config.key, {
      region: config.region,
      baseUri: config.baseUri,
    });

    this.datatypeMap = new Map([
      ["text", "string"],
      ["rich_text", "string"],
      ["number", "int"],
      ["date_time", "timestamp"],
      ["asset", "imageList"],
      ["modular_content", "set"],
      ["taxonomy", "set"],
      ["url_slug", "string"],
      ["multiple_choice", "set"],
      ["custom", "string"],
    ]);
  }

  private cleanHtml(str: string) {
    return str
      .replace(/&#([0-9]{1,3});/gi, (match, numStr) => {
        const num = parseInt(numStr, 10); // read num as normal number
        return String.fromCharCode(num);
      })
      .replace(/<[^>]*>?/gm, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\n/g, " ");
  }

  private getContentValuesForRecommendations(item: IContentItem): Record<string, unknown> {
    const itemFields = [
      ["system_codename", item.system.codename],
      ["system_language", item.system.language],
      ["system_last_modified", item.system.lastModified],
      ["system_type", item.system.type],
      ["system_collection", item.system.collection],
    ] as const;

    const elementFields: [string, unknown][] = Object.entries(item.elements)
      .map(([elementCodename, element]): [string, unknown] | null => {
        switch (element.type) {
          case ElementType.RichText:
            return [elementCodename, this.cleanHtml(element.value)];
          case ElementType.ModularContent:
            return [elementCodename, (element as Elements.LinkedItemsElement).linkedItems.map(i => i.system.codename)];
          case ElementType.Taxonomy:
            return [
              elementCodename,
              (element as Elements.TaxonomyElement).value.map((t: { codename: string }) => t.codename),
            ];
          case ElementType.Asset:
            return [elementCodename, (element as Elements.AssetsElement).value.map((a: { url: string }) => a.url)];
          default:
            return [elementCodename, element.value];
        }
      })
      .filter(notNull);

    return Object.fromEntries([...itemFields, ...elementFields]);
  }

  initStructure(elements: IGenericElement[]): Promise<void> {
    const requests = [
      new Recombee.requests.AddItemProperty("system_codename", "string"),
      new Recombee.requests.AddItemProperty("system_language", "string"),
      new Recombee.requests.AddItemProperty("system_last_modified", "timestamp"),
      new Recombee.requests.AddItemProperty("system_collection", "string"),
      new Recombee.requests.AddItemProperty("system_type", "string"),
      ...elements
        .map(element => {
          const dataType = this.datatypeMap.get(element.type);
          return dataType
            ? new Recombee.requests.AddItemProperty(element.codename ?? "", dataType)
            : null;
        })
        .filter(notNull),
    ];
    return this.client.send(new Recombee.requests.Batch(requests)).then(dropResult);
  }

  importContent(items: IContentItem[]): Promise<void> {
    const requests = items.map(item =>
      new Recombee.requests.SetItemValues(
        `${item.system.id}_${item.system.language}`,
        this.getContentValuesForRecommendations(item),
        { cascadeCreate: true },
      )
    );

    if (!requests.length) {
      return Promise.resolve();
    }

    return this.client.send(new Recombee.requests.Batch(requests)).then(dropResult);
  }

  deleteContent(ids: string[]): Promise<void> {
    const requests = ids.map(id => new Recombee.requests.DeleteItem(id));

    return this.client.send(new Recombee.requests.Batch(requests)).then(dropResult);
  }
}

const dropResult = () => {};
