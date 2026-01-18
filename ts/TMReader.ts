/*******************************************************************************
 * Copyright (c) 2022-2026 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse   License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/

import { appendFileSync, existsSync, unlinkSync } from 'node:fs';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import packageMetadataJson from '../package.json' with { type: 'json' };
import { Constants, DOMBuilder, Indenter, SAXParser, XMLAttribute, XMLDeclaration, XMLDocument, XMLElement, XMLNode, XMLUtils } from 'typesxml';

const SUCCESS: string = 'Success';

type PackageMetadata = {
    name?: string;
    version?: string;
};

type TranslationMemoryRow = {
    source_language: string;
    creation_user: string;
    creation_date: string;
};

type AttributeRow = {
    name: string;
    type: number;
    value: string;
};

type TranslationUnitRow = {
    id: number;
    source_segment: string;
    target_segment: string;
    creation_date: string;
    creation_user: string;
    change_date: string;
    change_user: string;
    last_used_date: string;
    last_used_user: string;
    usage_counter: string;
};

export type TMReaderResult = {
    status: typeof SUCCESS;
    count: number;
};

export type TMReaderOptions = {
    productName?: string;
    version?: string;
};

export class TMReader {

    private db: DatabaseSync;
    private parser: SAXParser;
    private contentHandler: DOMBuilder;
    private productName: string;
    private version: string;
    private tmx: string;
    private header: XMLElement;
    private indenter: Indenter;

    constructor(options: TMReaderOptions = {}) {
        const metadata: PackageMetadata = packageMetadataJson as PackageMetadata;
        const packageName: string | undefined = options.productName ?? metadata.name;
        if (!packageName) {
            throw new Error('productName missing in options and package metadata');
        }
        const packageVersion: string | undefined = options.version ?? metadata.version;
        if (!packageVersion) {
            throw new Error('version missing in options and package metadata');
        }
        this.productName = packageName;
        this.version = packageVersion;
        this.tmx = '';
        this.header = this.createHeader();
        this.parser = new SAXParser();
        this.contentHandler = new DOMBuilder();
        this.parser.setContentHandler(this.contentHandler);
        this.indenter = new Indenter(2, 2);
        this.db = new DatabaseSync(':memory:', { readOnly: true });
    }

    async convert(sdltm: string, tmx: string): Promise<TMReaderResult> {
        this.prepareOutput(sdltm, tmx);
        let count: number = 0;
        try {
            this.reopenDatabase(sdltm);
            this.populateHeader();
            this.writeHeader();
            count = this.writeTranslationUnits();
        } catch (error: unknown) {
            const failureMessage: string = error instanceof Error ? error.message : 'Unknown conversion error';
            throw new Error(failureMessage);
        } finally {
            this.resetDatabase();
        }
        return { status: SUCCESS, count: count };
    }

    private prepareOutput(sdltm: string, tmx: string): void {
        if (existsSync(tmx)) {
            unlinkSync(tmx);
        }
        this.tmx = tmx;
        this.header = this.createHeader();
    }

    private createHeader(): XMLElement {
        const header: XMLElement = new XMLElement('header');
        header.setAttribute(new XMLAttribute('creationtool', this.productName));
        header.setAttribute(new XMLAttribute('creationtoolversion', this.version));
        header.setAttribute(new XMLAttribute('o-tmf', 'SDLTM'));
        header.setAttribute(new XMLAttribute('adminlang', 'en-US'));
        header.setAttribute(new XMLAttribute('segtype', 'sentence'));
        header.setAttribute(new XMLAttribute('datatype', 'unknown'));
        return header;
    }

    private reopenDatabase(sdltm: string): void {
        try {
            this.db.close();
        } catch { /* db might already be closed */ }
        this.db = new DatabaseSync(sdltm, { readOnly: true });
    }

    private resetDatabase(): void {
        try {
            this.db.close();
        } catch { /* ignore close errors during reset */ }
        this.db = new DatabaseSync(':memory:', { readOnly: true });
    }

    private populateHeader(): void {
        this.applyHeaderAttributes();
        this.applyHeaderProperties();
    }

    private applyHeaderAttributes(): void {
        const statement: StatementSync = this.db.prepare('SELECT source_language, creation_user, creation_date FROM translation_memories');
        const rows: Array<TranslationMemoryRow> = statement.all() as Array<TranslationMemoryRow>;
        if (rows.length === 0) {
            throw new Error('translation_memories table is empty');
        }
        rows.forEach((row: TranslationMemoryRow) => {
            this.header.setAttribute(new XMLAttribute('srclang', row.source_language));
            this.header.setAttribute(new XMLAttribute('creationdate', this.tmxDateString(row.creation_date)));
            this.header.setAttribute(new XMLAttribute('creationid', row.creation_user));
        });
    }

    private applyHeaderProperties(): void {
        const propertiesMap: Map<string, XMLElement> = new Map<string, XMLElement>();
        const statement: StatementSync = this.db.prepare('SELECT attributes.name AS name, attributes.type AS type, picklist_values.value AS value FROM attributes INNER JOIN picklist_values ON picklist_values.attribute_id = attributes.id ORDER BY name');
        const rows: Array<AttributeRow> = statement.all() as Array<AttributeRow>;
        rows.forEach((row: AttributeRow) => {
            if (row.type === 5) {
                if (!propertiesMap.has(row.name)) {
                    const prop: XMLElement = new XMLElement('prop');
                    const propertyType: string = 'x-' + row.name + ':MultplePicklist';
                    prop.setAttribute(new XMLAttribute('type', propertyType));
                    this.header.addElement(prop);
                    propertiesMap.set(row.name, prop);
                }
                const prop: XMLElement | undefined = propertiesMap.get(row.name);
                if (prop) {
                    if (prop.getText() !== '') {
                        prop.addString(',');
                    }
                    prop.addString(row.value);
                }
            }
        });
    }

    private writeHeader(): void {
        this.indenter.indent(this.header);
        let headerString: string = new XMLDeclaration('1.0', 'UTF-8').toString();
        headerString += '\n<tmx version="1.4">\n  ';
        headerString += this.header.toString();
        headerString += '\n  <body>\n';
        appendFileSync(this.tmx, headerString, 'utf8');
    }

    private writeTranslationUnits(): number {
        const sql: string = 'SELECT id, source_segment, target_segment, creation_date, creation_user, change_date, change_user, last_used_date, last_used_user, usage_counter FROM translation_units';
        const statement: StatementSync = this.db.prepare(sql);
        const iterator: IterableIterator<unknown> = statement.iterate();
        let count: number = 0;
        let entry: IteratorResult<unknown> = iterator.next();
        while (!entry.done) {
            const row: TranslationUnitRow = entry.value as TranslationUnitRow;
            const source: XMLElement | undefined = this.toElement(row.source_segment);
            if (!source) {
                throw new Error('Cannot parse source segment');
            }
            const target: XMLElement | undefined = this.toElement(row.target_segment);
            if (!target) {
                throw new Error('Cannot parse target segment');
            }

            const tu: XMLElement = new XMLElement('tu');
            tu.setAttribute(new XMLAttribute('creationid', row.creation_user));
            tu.setAttribute(new XMLAttribute('creationdate', this.tmxDateString(row.creation_date)));
            const changeDate: string = this.tmxDateString(row.change_date);
            if (changeDate !== '') {
                tu.setAttribute(new XMLAttribute('changedate', changeDate));
            }
            const changeUser: string = row.change_user;
            if (changeUser !== '') {
                tu.setAttribute(new XMLAttribute('changeid', changeUser));
            }
            const lastUsedDate: string = row.last_used_date;
            if (lastUsedDate !== '') {
                tu.setAttribute(new XMLAttribute('lastusagedate', this.tmxDateString(lastUsedDate)));
            }
            const lastUsedUser: string = row.last_used_user;
            if (lastUsedUser !== '') {
                const prop: XMLElement = new XMLElement('prop');
                prop.setAttribute(new XMLAttribute('type', 'x-LastUsedBy'));
                prop.addString(lastUsedUser);
                tu.addElement(prop);
            }
            const usageCount: string = row.usage_counter;
            if (usageCount && usageCount !== '0') {
                tu.setAttribute(new XMLAttribute('usagecount', usageCount));
            }
            let cultureName: XMLElement | undefined = source.getChild('CultureName');
            if (!cultureName) {
                throw new Error('Source segment without CultureName child');
            }
            const srcLang: string = cultureName.getText();
            const srcTuv: XMLElement = new XMLElement('tuv');
            srcTuv.setAttribute(new XMLAttribute('xml:lang', srcLang));
            tu.addElement(srcTuv);
            const srcSeg: XMLElement = new XMLElement('seg');
            const srcElements: XMLElement | undefined = source.getChild('Elements');
            if (!srcElements) {
                throw new Error('Source segment without Elements child');
            }
            srcSeg.setContent(this.parseContent(srcElements));
            srcTuv.addElement(srcSeg);

            cultureName = target.getChild('CultureName');
            if (!cultureName) {
                throw new Error('Target segment without CultureName child');
            }
            const tgtLang: string = cultureName.getText();
            const tgtTuv: XMLElement = new XMLElement('tuv');
            tgtTuv.setAttribute(new XMLAttribute('xml:lang', tgtLang));
            tu.addElement(tgtTuv);
            const tgtSeg: XMLElement = new XMLElement('seg');
            const tgtElements: XMLElement | undefined = target.getChild('Elements');
            if (!tgtElements) {
                throw new Error('Target segment without Elements child');
            }
            tgtSeg.setContent(this.parseContent(tgtElements));
            tgtTuv.addElement(tgtSeg);

            this.indenter.indent(tu);
            appendFileSync(this.tmx, '  ' + tu.toString() + '\n', 'utf8');
            count += 1;
            entry = iterator.next();
        }
        appendFileSync(this.tmx, '  </body>\n</tmx>', 'utf8');
        return count;
    }

    toElement(text: string): XMLElement | undefined {
        this.parser.parseString(XMLUtils.validXml10Chars(text));
        const doc: XMLDocument | undefined = this.contentHandler.getDocument();
        return doc ? doc.getRoot() : undefined;
    }

    parseContent(element: XMLElement): Array<XMLNode> {
        let result: XMLElement = new XMLElement('seg');
        let nodes: Array<XMLNode> = element.getContent();
        nodes.forEach((node: XMLNode) => {
            if (node.getNodeType() === Constants.ELEMENT_NODE) {
                let child: XMLElement = node as XMLElement;
                if ('Text' === child.getName()) {
                    let value: XMLElement | undefined = child.getChild('Value');
                    if (!value) {
                        throw new Error('Text element without Value child');
                    }
                    result.addString(value.getText());
                }
                if ('Tag' === child.getName()) {
                    let type: XMLElement | undefined = child.getChild('Type');
                    if (!type) {
                        throw new Error('Tag element without Type child');
                    }
                    let tagType: string = type.getText();
                    if (tagType === 'Start') {
                        let anchor: XMLElement | undefined = child.getChild('Anchor');
                        if (!anchor) {
                            throw new Error('Start Tag element without Anchor child');
                        }
                        let alignmentAnchor: XMLElement | undefined = child.getChild('AlignmentAnchor');
                        if (!alignmentAnchor) {
                            throw new Error('Start Tag element without AlignmentAnchor child');
                        }
                        let tagIdD: XMLElement | undefined = child.getChild('TagID');
                        if (!tagIdD) {
                            throw new Error('Start Tag element without TagID child');
                        }
                        let bpt: XMLElement = new XMLElement('bpt');
                        bpt.setAttribute(new XMLAttribute('i', anchor.getText()));
                        bpt.setAttribute(new XMLAttribute('x', alignmentAnchor.getText()));
                        bpt.setAttribute(new XMLAttribute('type', tagIdD.getText()));
                        result.addElement(bpt);
                    } else if (tagType === 'End') {
                        let anchor: XMLElement | undefined = child.getChild('Anchor');
                        if (!anchor) {
                            throw new Error('End Tag element without Anchor child');
                        }
                        let ept: XMLElement = new XMLElement('ept');
                        ept.setAttribute(new XMLAttribute('i', anchor.getText()));
                        result.addElement(ept);
                    } else {
                        let alignmentAnchor: XMLElement | undefined = child.getChild('AlignmentAnchor');
                        if (!alignmentAnchor) {
                            throw new Error('Standalone Tag element without AlignmentAnchor child');
                        }
                        let tagIdD: XMLElement | undefined = child.getChild('TagID');
                        if (!tagIdD) {
                            throw new Error('Standalone Tag element without TagID child');
                        }
                        let ph: XMLElement = new XMLElement('ph');
                        ph.setAttribute(new XMLAttribute('x', alignmentAnchor.getText()));
                        ph.setAttribute(new XMLAttribute('type', tagIdD.getText()));
                        result.addElement(ph);
                    }
                }
            }
        });
        return result.getContent();
    }

    tmxDateString(date: string): string {
        while (date.indexOf('-') != -1) {
            date = date.replace('-', '');
        }
        while (date.indexOf(':') != -1) {
            date = date.replace(':', '');
        }
        return date.replace(' ', 'T') + 'Z';
    }
}