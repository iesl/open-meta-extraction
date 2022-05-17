import _ from 'lodash';
import { HostStatus, HostStatusUpdateFields, NoteStatus, WorkflowStatus } from './schemas';
import { isUrl, validateUrl } from '~/workflow/common/datatypes';
import * as E from 'fp-ts/Either';
import { getServiceLogger, prettyFormat, prettyPrint } from '@watr/commonlib';
import { Document } from 'mongoose';

type HostStatusDocument = Document<unknown, any, HostStatus> & HostStatus;

type upsertNoteStatusArgs = {
    noteId: string,
    urlstr?: string
}

const log = getServiceLogger('query-api');

export async function upsertNoteStatus({
    noteId, urlstr
}: upsertNoteStatusArgs): Promise<NoteStatus> {
    const maybeUrl = validateUrl(urlstr);
    const validUrl = E.isRight(maybeUrl);


    const urlOrErrStr = E.fold<string, URL, string>(
        () => `Invalid URL: ${urlstr}`,
        success => success.toString()
    )(maybeUrl);

    // log.info(`upsertNoteStatus(${noteId}, ${urlOrErrStr})`);

    return NoteStatus.findOneAndUpdate(
        { _id: noteId },
        { validUrl, url: urlOrErrStr },
        { new: true, upsert: true }
    );
}

export async function findNoteStatusById(noteId: string): Promise<NoteStatus | undefined> {
    const ret = await NoteStatus.findOne({ _id: noteId });
    return ret !== null ? ret : undefined;
}

export async function upsertHostStatus(noteId: string, workflowStatus: WorkflowStatus, fields: HostStatusUpdateFields): Promise<HostStatusDocument> {

    const setQ: Record<string, any> = {};
    const unsetQ: Record<string, any> = {};

    _.merge(setQ, fields, { workflowStatus });

    if ('response' in fields) {
        const { response } = fields;
        const maybeUrl = validateUrl(response);
        const validResponseUrl = E.isRight(maybeUrl);
        _.merge(setQ, { validResponseUrl });

        if (validResponseUrl) {
            const responseHost = maybeUrl.right.hostname;
            _.merge(setQ, { responseHost })
        } else {
            _.merge(unsetQ, { responseHost: '' })
        }
    }


    const updateQ: Record<string, any> = {
        $set: setQ,
        $unset: unsetQ,
    };
    // const pf = prettyFormat(updateQ);
    // log.verbose(`upsertHostStatus(id:${noteId}, fields:${pf})`);
    const updated =  await HostStatus.findOneAndUpdate(
        { _id: noteId },
        updateQ,
        { new: true, upsert: true, runValidators: true }
    );
    return updated;
}

export async function findHostStatusById(noteId: string): Promise<HostStatusDocument | undefined> {
    const ret = await HostStatus.findOne({ _id: noteId });
    return ret !== null ? ret : undefined;
}



export async function getNextSpiderableUrl(): Promise<HostStatusDocument | undefined> {
    const next = await HostStatus.findOneAndUpdate(
        { hasAbstract: false, workflowStatus: 'available' },
        { workflowStatus: 'spider:locked' },
        { new: true }
    );
    return next !== null ? next : undefined;
}

export async function releaseSpiderableUrl(hostStatus: HostStatusDocument, newStatus: WorkflowStatus): Promise<HostStatusDocument> {
    hostStatus.workflowStatus = newStatus;
    return hostStatus.save();
}