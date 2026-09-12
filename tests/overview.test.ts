import { it,expect,vi } from 'vitest';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
import type { CourseContextIndex, VideoLearningStatus } from '../src/models/Learning.js';
const video=(applicability:VideoLearningStatus['applicability'],state:VideoLearningStatus['state'],id:string):VideoLearningStatus=>({videoId:id,courseId:'7',title:`Synthetic ${id}`,attendanceTarget:applicability==='required'?'yes':applicability==='unknown'?'unknown':'no',applicability,applicabilityConfidence:'high',state,completionBasis:'progress',confidence:'high',warnings:[]});
it('never aggregates optional, excluded, or unknown audience videos as required incomplete',async()=>{
  const auth=new PlaywrightAuthManager({getCredentials:async()=>{throw Error();}}),client=new LearnUsClient(auth);
  const items=[video('not_applicable','not_required','1'),video('optional','not_required','2'),video('unknown','in_progress','3'),video('required','in_progress','4')];
  vi.spyOn(client,'courseContext').mockResolvedValue({courseId:'7',weeks:[{week:2,start:'2026-09-01T00:00:00+09:00'}],activities:[],videos:items,audienceContext:[],fetchedAt:Date.now(),warnings:[]} satisfies CourseContextIndex);
  vi.spyOn(client,'getVideoAttendance').mockResolvedValue({mode:'progress',items,currentWeek:2,warnings:[]});
  const result=await client.learningOverview({courseId:'7',week:'all'});
  expect(result.requiredIncomplete.map(v=>v.videoId)).toEqual(['4']);expect(result.excludedOrOptional.map(v=>v.videoId)).toEqual(['1','2']);expect(result.unknown.map(v=>v.videoId)).toEqual(['3']);await auth.close();
});
