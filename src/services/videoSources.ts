import type { VideoSource } from '@/types/video'

export const VIDEO_SOURCE_STORAGE_KEY = 'sollin-video-source-v1'

export const VIDEO_SOURCES: VideoSource[] = [
  { id: 'ffzy', name: '非凡资源', url: 'http://api.ffzyapi.com/api.php/provide/vod/', group: '推荐' },
  { id: 'suoni', name: '索尼资源', url: 'https://suoniapi.com/api.php/provide/vod/', group: '推荐' },
  { id: 'pingguo', name: '苹果资源', url: 'http://zhangqun19.serv00.net/pingguo.php', group: '推荐', note: '单文件采集接口' },
  { id: 'jingpin', name: '精品资源', url: 'https://www.jingpinx.com/api.php/provide/vod/', group: '推荐' },
  { id: 'souav', name: 'SouAV资源', url: 'https://api.souavzy.vip/api.php/provide/vod/', group: '推荐' },

  { id: 'hongniu', name: '红牛资源', url: 'https://www.hongniuzy2.com/api.php/provide/vod/', group: '集合' },
  { id: 'guangsu', name: '光速资源', url: 'https://api.guangsuapi.com/api.php/provide/vod/', group: '集合' },
  { id: 'haohua', name: '豪华资源', url: 'https://hhzyapi.com/api.php/provide/vod/', group: '集合' },
  { id: 'subo', name: '速播资源', url: 'https://subocj.com/api.php/provide/vod/', group: '集合' },
  { id: 'huya', name: '虎牙资源', url: 'https://huyaapi.com/api.php/provide/vod/', group: '集合' },
  { id: 'xinlang', name: '新浪资源', url: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod/', group: '集合' },
  { id: 'jinying', name: '金鹰资源', url: 'https://jyzyapi.com/provide/vod/', group: '集合' },
  { id: 'zy360', name: '360资源', url: 'https://360zyzz.com/api.php/provide/vod/', group: '集合' },
  { id: 'zuida', name: '最大资源', url: 'https://api.zuidapi.com/api.php/provide/vod/', group: '集合' },
  { id: 'okzy', name: 'OK资源', url: 'https://api.okzyw.net/api.php/provide/vod/', group: '集合' },
  { id: 'xigua', name: '西瓜资源', url: 'https://caiji.xgzyapi.com/api.php/provide/vod/', group: '集合' },
  { id: 'wsy', name: '无水印资源', url: 'https://api.wsyzy.net/api.php/provide/vod/', group: '集合' },
  { id: 'iqiyi', name: '爱奇艺资源', url: 'https://iqiyizyapi.com/api.php/provide/vod/', group: '集合' },
  { id: 'maotai', name: '茅台资源', url: 'https://caiji.maotai999.vip/api.php/provide/vod/', group: '集合' },
  { id: 'niuniu', name: '牛牛资源', url: 'https://api.niuniuzy.me/api.php/provide/vod/', group: '集合' },
  { id: 'yaya', name: '鸭鸭资源', url: 'https://cj.yayazy.net/api.php/provide/vod/', group: '集合' },
  { id: 'maoyan', name: '猫眼资源', url: 'https://api.maoyanapi.top/api.php/provide/vod/', group: '集合' },
  { id: 'douban', name: '豆瓣资源', url: 'https://caiji.dbzy5.com/api.php/provide/vod/', group: '集合' },
  { id: 'ruyi', name: '如意资源', url: 'https://cj.rycjapi.com/api.php/provide/vod/', group: '集合' },
  { id: 'dytt', name: '电影天堂资源', url: 'http://caiji.dyttzyapi.com/api.php/provide/vod/', group: '集合' },
  { id: 'baofeng', name: '暴风资源', url: 'https://bfzyapi.com/api.php/provide/vod/', group: '集合' },
  { id: 'kuaiche', name: '快车资源', url: 'https://caiji.kuaichezy.org/api.php/provide/vod/', group: '集合' },
  { id: 'wujin', name: '无尽资源', url: 'https://api.wujinapi.me/api.php/provide/vod/', group: '集合' },
  { id: 'modu', name: '魔都资源', url: 'https://www.mdzyapi.com/api.php/provide/vod/', group: '集合' },

  { id: 'youzhi', name: '优质资源', url: 'https://api.yyzy-tv.vip/inc/apijson.php', group: '特殊', note: '特殊入口，按标准 JSON 采集协议兼容' },
  { id: 'jisu', name: '极速资源', url: 'https://jszyapi.com/api.php/provide/vod/', group: '特殊', categoryAc: 'ac=videolist', note: '分类接口使用 ac=videolist' },
]

export const getDefaultVideoSourceId = () => VIDEO_SOURCES[0]?.id || 'ffzy'

export const getVideoSource = (sourceId?: string) => VIDEO_SOURCES.find((item) => item.id === sourceId) || VIDEO_SOURCES[0]

export const getGroupedVideoSources = () => VIDEO_SOURCES.reduce<Record<string, VideoSource[]>>((groups, source) => {
  const group = source.group || '集合'
  groups[group] = groups[group] || []
  groups[group].push(source)
  return groups
}, {})
