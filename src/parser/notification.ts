import { cleanText } from './dashboard.js';
import { contentDocument, contentText, contentUrl } from './content.js';
import type { LearnUsNotification, ListResult } from '../models/Announcement.js';
import { dedupeBy, normalizeDate, notificationIdentity } from '../normalize.js';
export function parseNotifications(html: string | undefined): ListResult<LearnUsNotification> {
  if (typeof html !== 'string') return {items:[],warnings:['NOTIFICATION_STRUCTURE_UNRECOGNIZED']};
  const $ = contentDocument(html), items: LearnUsNotification[] = [];
  const rows = $('.media-lists .media,.notification-item,[data-notification-id]');
  let malformed = false;
  rows.each((_,element)=>{
    const row = $(element);
    const title = cleanText(row.find('.text-title,.notification-title,.title').first().text()) || undefined;
    const message = row.find('.text-truncate,.notification-text,.message').first();
    const text = message.length ? contentText(message.html() || '') || undefined : undefined;
    if (!title && !text) { malformed = true; return; }
    const id = row.attr('data-notification-id') || row.attr('data-id');
    const read = row.attr('data-read');
    const a = row.is('a') ? row : row.find('a[href]').first();
    const item: LearnUsNotification = {id:id && /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : undefined,title,text,
      createdAt:normalizeDate(row.find('time').first().attr('datetime') || cleanText(row.find('.text-muted,.created-at,.date').first().text())),
      url:contentUrl(a.attr('href') || ''),
      read:read==='true'||read==='1' ? true : read==='false'||read==='0' ? false : row.hasClass('unread') ? false : row.hasClass('read') ? true : undefined};
    items.push(item);
  });
  const empty = /알림(?:이|은)?\s*없|새로운\s*알림이\s*없|no\s+notifications/i.test($.root().text()) ||
    !!$('.media-lists,.notification-list').length && !rows.length && !cleanText($('.media-lists,.notification-list').text());
  const unique=dedupeBy(items,item=>notificationIdentity(item));
  return {items:unique,warnings:unique.length ? malformed ? ['NOTIFICATION_FIELDS_MISSING'] : [] :
    [empty && !malformed ? 'NO_NOTIFICATIONS_FOUND' : 'NOTIFICATION_STRUCTURE_UNRECOGNIZED']};
}
